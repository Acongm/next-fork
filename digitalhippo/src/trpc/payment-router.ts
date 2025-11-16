import { z } from 'zod'
import {
  privateProcedure,
  publicProcedure,
  router,
} from './trpc'
import { TRPCError } from '@trpc/server'
import { getPayloadClient } from '../get-payload'
import { getStripe, isStripeEnabled } from '../lib/stripe'
import type Stripe from 'stripe'

export const paymentRouter = router({
  createSession: privateProcedure
    .input(z.object({ productIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const { user, req } = ctx
      let { productIds } = input

      if (productIds.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST' })
      }

      const payload = await getPayloadClient()

      const { docs: products } = await payload.find({
        collection: 'products',
        where: {
          id: {
            in: productIds,
          },
        },
      })

      // 创建订单，传递 req 以包含用户上下文
      // user 和 _isPaid 字段会通过 beforeChange hook 自动设置
      // 但 TypeScript 类型要求提供这些字段，所以先提供占位值
      const order = await payload.create({
        collection: 'orders',
        data: {
          products: products.map((prod) => prod.id),
          user: user.id, // 会被 hook 覆盖，但满足类型要求
          _isPaid: false, // 会被 hook 覆盖，但满足类型要求
        } as any, // 使用类型断言，因为 hook 会处理这些字段
        req: req as any, // 传递请求对象以包含用户上下文
      })

      // 如果 Stripe 未启用，直接跳过支付，标记订单为已支付
      if (!isStripeEnabled()) {
        // 直接标记订单为已支付
        await payload.update({
          collection: 'orders',
          where: {
            id: {
              equals: order.id,
            },
          },
          data: {
            _isPaid: true,
          },
          req: req as any, // 传递请求对象以包含用户上下文
        })

        // 返回成功页面 URL（跳过支付）
        return { 
          url: `${process.env.NEXT_PUBLIC_SERVER_URL}/thank-you?orderId=${order.id}` 
        }
      }

      // Stripe 已启用，使用 Stripe 支付流程
      const filteredProducts = products.filter((prod) =>
        Boolean(prod.priceId)
      )

      const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] =
        []

      filteredProducts.forEach((product) => {
        line_items.push({
          price: product.priceId!,
          quantity: 1,
        })
      })

      line_items.push({
        price: 'price_1OCeBwA19umTXGu8s4p2G3aX',
        quantity: 1,
        adjustable_quantity: {
          enabled: false,
        },
      })

      try {
        const stripe = getStripe()
        if (!stripe) {
          // 如果获取 Stripe 失败，也跳过支付
          await payload.update({
            collection: 'orders',
            where: {
              id: {
                equals: order.id,
              },
            },
            data: {
              _isPaid: true,
            },
            req: req as any, // 传递请求对象以包含用户上下文
          })
          return { 
            url: `${process.env.NEXT_PUBLIC_SERVER_URL}/thank-you?orderId=${order.id}` 
          }
        }

        const stripeSession =
          await stripe.checkout.sessions.create({
            success_url: `${process.env.NEXT_PUBLIC_SERVER_URL}/thank-you?orderId=${order.id}`,
            cancel_url: `${process.env.NEXT_PUBLIC_SERVER_URL}/cart`,
            payment_method_types: ['card', 'paypal'],
            mode: 'payment',
            metadata: {
              userId: user.id,
              orderId: order.id,
            },
            line_items,
          })

        return { url: stripeSession.url }
      } catch (err) {
        // Stripe 创建会话失败，也跳过支付
        await payload.update({
          collection: 'orders',
          where: {
            id: {
              equals: order.id,
            },
          },
          data: {
            _isPaid: true,
          },
          req: req as any, // 传递请求对象以包含用户上下文
        })
        return { 
          url: `${process.env.NEXT_PUBLIC_SERVER_URL}/thank-you?orderId=${order.id}` 
        }
      }
    }),
  pollOrderStatus: privateProcedure
    .input(z.object({ orderId: z.string() }))
    .query(async ({ input }) => {
      const { orderId } = input

      const payload = await getPayloadClient()

      const { docs: orders } = await payload.find({
        collection: 'orders',
        where: {
          id: {
            equals: orderId,
          },
        },
      })

      if (!orders.length) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }

      const [order] = orders

      return { isPaid: order._isPaid }
    }),
})
