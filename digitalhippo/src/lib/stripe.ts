import Stripe from 'stripe'

// 检查是否配置了 Stripe API key
export const isStripeEnabled = () => {
  return !!process.env.STRIPE_SECRET_KEY
}

// 延迟初始化 Stripe，只在需要时创建实例
// 如果没有配置 API key，返回 null（不抛出错误）
export const getStripe = (): Stripe | null => {
  const apiKey = process.env.STRIPE_SECRET_KEY
  if (!apiKey) {
    return null
  }
  return new Stripe(apiKey, {
    apiVersion: '2023-10-16',
    typescript: true,
  })
}

// 为了向后兼容，保留 stripe 导出，但只在有 API key 时才初始化
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16',
      typescript: true,
    })
  : (null as unknown as Stripe)
