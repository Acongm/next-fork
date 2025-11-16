import express from 'express'
import { WebhookRequest } from './server'
import { getStripe, isStripeEnabled } from './lib/stripe'
import type Stripe from 'stripe'
import { getPayloadClient } from './get-payload'
import { Product, User } from './payload-types'
import { Resend } from 'resend'
import { ReceiptEmailHtml } from './components/emails/ReceiptEmail'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({
  path: path.resolve(__dirname, '../.env'),
})

// 延迟初始化 Resend，只在需要时创建实例
const getResend = () => {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is missing. Please set it in your .env file.')
  }
  return new Resend(apiKey)
}

export const stripeWebhookHandler = async (
  req: express.Request,
  res: express.Response
) => {
  // 如果 Stripe 未启用，直接返回成功（不处理 webhook）
  if (!isStripeEnabled()) {
    return res.status(200).send('Stripe is not enabled')
  }

  const webhookRequest = req as any as WebhookRequest
  const body = webhookRequest.rawBody
  const signature = req.headers['stripe-signature'] || ''

  let event
  try {
    const stripe = getStripe()
    if (!stripe) {
      return res.status(200).send('Stripe is not configured')
    }
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    )
  } catch (err) {
    return res
      .status(400)
      .send(
        `Webhook Error: ${err instanceof Error
          ? err.message
          : 'Unknown Error'
        }`
      )
  }

  const session = event.data
    .object as Stripe.Checkout.Session

  if (
    !session?.metadata?.userId ||
    !session?.metadata?.orderId
  ) {
    return res
      .status(400)
      .send(`Webhook Error: No user present in metadata`)
  }

  if (event.type === 'checkout.session.completed') {
    const payload = await getPayloadClient()

    const { docs: users } = await payload.find({
      collection: 'users',
      where: {
        id: {
          equals: session.metadata.userId,
        },
      },
    })

    const [user] = users as unknown as User[]

    if (!user || !user.email)
      return res
        .status(404)
        .json({ error: 'No such user exists.' })

    const { docs: orders } = await payload.find({
      collection: 'orders',
      depth: 2,
      where: {
        id: {
          equals: session.metadata.orderId,
        },
      },
    })

    const [order] = orders

    if (!order)
      return res
        .status(404)
        .json({ error: 'No such order exists.' })

    await payload.update({
      collection: 'orders',
      data: {
        _isPaid: true,
      },
      where: {
        id: {
          equals: session.metadata.orderId,
        },
      },
    })

    // send receipt
    try {
      const resend = getResend()
      
      const data = await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: [user.email],
        subject:
          'Thanks for your order! This is your receipt.',
        html: ReceiptEmailHtml({
          date: new Date(),
          email: user.email,
          orderId: session.metadata.orderId,
          products: order.products as Product[],
        }),
      })
      res.status(200).json({ data })
    } catch (error) {
      res.status(500).json({ error })
    }
  }

  return res.status(200).send()
}
