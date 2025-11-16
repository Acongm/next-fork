# 项目配置和修复记录

本文档记录了 DigitalHippo 项目的配置修复和功能改进。

## 日期
2024年（具体日期根据实际情况填写）

## 概述
本次改动主要解决了项目启动时的环境变量配置问题、支付功能可选化、以及订单创建时的验证错误。

---

## 1. 环境变量配置修复

### 1.1 创建 .env 文件
**问题**: 项目缺少 `.env` 文件，导致环境变量无法加载。

**解决方案**:
- 从 `.env.local` 复制创建 `.env` 文件
- 生成并配置 `PAYLOAD_SECRET`
- 配置 `MONGODB_URL` 为本地 MongoDB 连接字符串

**相关文件**:
- `.env` (新建)

**配置内容**:
```env
NEXT_PUBLIC_SERVER_URL=http://localhost:3000
PAYLOAD_SECRET=4659
MONGODB_URL=mongodb://localhost:27017/digitalhippo
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RESEND_API_KEY=re_EYv
```

---

## 2. Resend 邮件服务修复

### 2.1 延迟初始化 Resend
**问题**: `src/webhooks.ts` 在模块加载时初始化 Resend，但环境变量可能尚未加载，导致 `Missing API key` 错误。

**解决方案**:
- 在 `src/webhooks.ts` 顶部添加 `dotenv.config()` 加载环境变量
- 将 Resend 初始化改为延迟初始化（`getResend()` 函数）
- 只在需要发送邮件时才创建 Resend 实例

**修改文件**: `src/webhooks.ts`

**关键改动**:
```typescript
// 添加 dotenv 配置
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({
  path: path.resolve(__dirname, '../.env'),
})

// 延迟初始化 Resend
const getResend = () => {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is missing. Please set it in your .env file.')
  }
  return new Resend(apiKey)
}
```

### 2.2 修复邮件发送域名验证问题
**问题**: 使用未验证的域名 `hello@joshtriedcoding.com` 导致邮件发送失败。

**解决方案**:
- 将发件人地址改为 Resend 提供的测试地址 `onboarding@resend.dev`
- 该地址无需域名验证即可使用

**修改文件**:
- `src/get-payload.ts`
- `src/webhooks.ts`

**改动内容**:
```typescript
// 修改前
fromAddress: 'hello@joshtriedcoding.com'
from: 'DigitalHippo <hello@joshtriedcoding.com>'

// 修改后
fromAddress: 'onboarding@resend.dev'
from: 'DigitalHippo <onboarding@resend.dev>'
```

---

## 3. Stripe 支付功能可选化

### 3.1 问题描述
**问题**: 项目要求配置 Stripe API key，但用户可能暂时不需要支付功能，导致应用无法启动。

**需求**: 保留 Stripe 代码，但允许在没有配置 API key 的情况下正常运行，支付功能自动跳过。

### 3.2 解决方案

#### 3.2.1 修改 Stripe 初始化逻辑
**修改文件**: `src/lib/stripe.ts`

**改动内容**:
```typescript
// 检查是否配置了 Stripe API key
export const isStripeEnabled = () => {
  return !!process.env.STRIPE_SECRET_KEY
}

// 延迟初始化 Stripe，如果没有配置 API key，返回 null（不抛出错误）
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
```

#### 3.2.2 修改支付路由
**修改文件**: `src/trpc/payment-router.ts`

**改动内容**:
- 当 Stripe 未启用时，直接跳过支付流程
- 自动将订单标记为已支付
- 直接返回成功页面 URL

**关键逻辑**:
```typescript
// 如果 Stripe 未启用，直接跳过支付，标记订单为已支付
if (!isStripeEnabled()) {
  await payload.update({
    collection: 'orders',
    where: { id: { equals: order.id } },
    data: { _isPaid: true },
    req: req as any,
  })
  return { 
    url: `${process.env.NEXT_PUBLIC_SERVER_URL}/thank-you?orderId=${order.id}` 
  }
}
```

#### 3.2.3 修改产品同步逻辑
**修改文件**: `src/collections/Products/Products.ts`

**改动内容**:
- 在产品创建/更新时，如果 Stripe 未启用，跳过 Stripe 同步
- 添加错误处理，即使 Stripe 同步失败也不阻止产品创建/更新

**关键逻辑**:
```typescript
async (args) => {
  // 如果 Stripe 未启用，跳过同步
  if (!isStripeEnabled() || !stripe) {
    return args.data
  }
  // ... Stripe 同步逻辑
  try {
    // Stripe 操作
  } catch (err) {
    // Stripe 失败时返回原始数据，不阻止产品创建/更新
    console.warn('Failed to sync product to Stripe:', err)
    return args.data
  }
}
```

#### 3.2.4 修改 Webhook 处理
**修改文件**: `src/webhooks.ts`

**改动内容**:
- 当 Stripe 未启用时，直接返回成功，不处理 webhook

**关键逻辑**:
```typescript
export const stripeWebhookHandler = async (req, res) => {
  // 如果 Stripe 未启用，直接返回成功（不处理 webhook）
  if (!isStripeEnabled()) {
    return res.status(200).send('Stripe is not enabled')
  }
  // ... 正常的 webhook 处理逻辑
}
```

---

## 4. 订单创建功能修复

### 4.1 修复访问控制问题
**问题**: `Orders` 集合的 `create` 访问控制只允许管理员创建订单，但普通用户也需要通过支付流程创建订单。

**解决方案**:
**修改文件**: `src/collections/Orders.ts`

**改动内容**:
```typescript
access: {
  read: yourOwn,
  update: ({ req }) => req.user.role === 'admin',
  delete: ({ req }) => req.user.role === 'admin',
  // 允许已认证的用户创建订单（用于支付流程）
  create: ({ req }) => !!req.user,
},
```

### 4.2 添加自动设置字段的 Hooks
**问题**: `user` 和 `_isPaid` 字段是必需的，但应该通过 hook 自动设置，而不是由用户直接提供。

**解决方案**:
**修改文件**: `src/collections/Orders.ts`

**改动内容**:
```typescript
// 自动设置 user 字段
const addUser: BeforeChangeHook = ({ req, data }) => {
  const user = req.user
  if (user) {
    return { ...data, user: user.id }
  }
  return data
}

// 自动设置 _isPaid 默认值为 false
const setDefaultIsPaid: BeforeChangeHook = ({ data }) => {
  return {
    ...data,
    _isPaid: data._isPaid ?? false,
  }
}

// 在配置中使用 hooks
hooks: {
  beforeChange: [addUser, setDefaultIsPaid],
},

// 字段访问控制
fields: [
  {
    name: 'user',
    // ...
    access: {
      create: () => false, // 不允许直接设置，通过 hook 自动设置
      update: () => false,
    },
  },
  {
    name: '_isPaid',
    // ...
    access: {
      create: () => false,
      update: () => false,
    },
    defaultValue: false,
  },
]
```

### 4.3 修复 tRPC 上下文传递
**问题**: Payload 操作需要用户上下文来验证访问控制和执行 hooks，但 tRPC 上下文没有传递 `req` 对象。

**解决方案**:
**修改文件**: `src/trpc/trpc.ts`

**改动内容**:
```typescript
const isAuth = middleware(async ({ ctx, next }) => {
  const req = ctx.req as PayloadRequest
  const { user } = req as { user: User | null }

  if (!user || !user.id) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }

  return next({
    ctx: {
      user,
      req, // 传递 req 以便在 Payload 操作中使用
    },
  })
})
```

**修改文件**: `src/trpc/payment-router.ts`

**改动内容**:
```typescript
// 在所有 Payload 操作中传递 req
const order = await payload.create({
  collection: 'orders',
  data: { /* ... */ },
  req: req as any, // 传递请求对象以包含用户上下文
})
```

### 4.4 修复 TypeScript 类型错误
**问题**: TypeScript 类型系统要求必需字段必须提供，即使它们会在 hook 中设置。

**解决方案**:
**修改文件**: `src/trpc/payment-router.ts`

**改动内容**:
```typescript
const order = await payload.create({
  collection: 'orders',
  data: {
    products: products.map((prod) => prod.id),
    user: user.id, // 会被 hook 覆盖，但满足类型要求
    _isPaid: false, // 会被 hook 覆盖，但满足类型要求
  } as any, // 使用类型断言，因为 hook 会处理这些字段
  req: req as any,
})
```

---

## 5. 管理员账号创建工具

### 5.1 创建脚本
**文件**: `create-admin-simple.js`

**功能**: 通过 MongoDB 直接创建管理员账号

**使用方法**:
```bash
node create-admin-simple.js admin@example.com admin123
```

**说明**: 
- 如果已存在管理员账号，会显示现有管理员信息
- 如果不存在，会创建新的管理员账号
- 密码会进行简单的加密处理

**注意**: 由于 Payload 使用特定的密码加密方式，通过此脚本创建的账号可能需要通过前端注册后再修改角色为管理员。

---

## 6. 文件清单

### 6.1 修改的文件
1. `src/webhooks.ts` - Resend 延迟初始化，修复邮件域名
2. `src/get-payload.ts` - 修复邮件发件人地址
3. `src/lib/stripe.ts` - Stripe 可选化支持
4. `src/trpc/payment-router.ts` - 支付功能可选化，订单创建修复
5. `src/collections/Products/Products.ts` - Stripe 同步可选化
6. `src/collections/Orders.ts` - 访问控制和 hooks 修复
7. `src/trpc/trpc.ts` - 上下文传递修复

### 6.2 新建的文件
1. `.env` - 环境变量配置文件
2. `create-admin-simple.js` - 管理员账号创建脚本
3. `create-admin.ts` - TypeScript 版本的管理员创建脚本（未使用）
4. `create-admin-correct.js` - 管理员账号管理脚本（辅助工具）

---

## 7. 功能改进总结

### 7.1 环境变量处理
- ✅ 所有环境变量都有合理的默认值或错误处理
- ✅ 应用可以在缺少可选环境变量（如 Stripe）的情况下启动
- ✅ 提供了清晰的错误提示

### 7.2 支付功能
- ✅ Stripe 完全可选，不影响其他功能
- ✅ 没有 Stripe 时，订单流程自动跳过支付步骤
- ✅ 订单会自动标记为已支付，用户可以正常完成购物流程

### 7.3 订单管理
- ✅ 普通用户可以创建订单
- ✅ 用户字段自动关联
- ✅ 支付状态自动管理

### 7.4 邮件功能
- ✅ 使用无需验证的测试邮箱地址
- ✅ 延迟初始化，避免启动时错误

---

## 8. 使用说明

### 8.1 启动项目
1. 确保 MongoDB 正在运行（本地或远程）
2. 确保 `.env` 文件已配置
3. 运行 `yarn dev` 启动开发服务器

### 8.2 配置 Stripe（可选）
如果需要支付功能：
1. 在 Stripe Dashboard 获取 API keys
2. 在 `.env` 文件中配置：
   ```env
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

### 8.3 创建管理员账号
**方法 1**: 通过前端注册后修改角色
1. 访问 `http://localhost:3000/sign-up` 注册账号
2. 使用 MongoDB Compass 或脚本将用户角色改为 `admin`

**方法 2**: 使用脚本（可能需要手动验证密码）
```bash
node create-admin-simple.js your-email@example.com your-password
```

### 8.4 访问管理界面
- URL: `http://localhost:3000/sell`
- 使用管理员账号登录

---

## 9. 注意事项

1. **MongoDB 连接**: 确保 MongoDB 服务正在运行，或使用 MongoDB Atlas 云服务
2. **环境变量**: `.env` 文件不应提交到版本控制（已在 `.gitignore` 中）
3. **Stripe 测试**: 开发环境建议使用 Stripe 测试模式的 API keys
4. **邮件发送**: 使用 `onboarding@resend.dev` 仅用于开发测试，生产环境需要验证域名
5. **密码安全**: 生产环境应使用强密码和安全的密码加密方式

---

## 10. 后续建议

1. **生产环境配置**:
   - 配置真实的 MongoDB 连接字符串
   - 验证 Resend 域名或使用其他邮件服务
   - 配置 Stripe 生产环境 API keys
   - 使用环境变量管理工具（如 AWS Secrets Manager）

2. **安全性增强**:
   - 实现更严格的访问控制
   - 添加请求频率限制
   - 实现 CSRF 保护
   - 添加输入验证和清理

3. **功能完善**:
   - 实现完整的支付流程测试
   - 添加订单状态管理
   - 实现退款功能
   - 添加邮件模板自定义

---

## 11. 问题排查

### 11.1 常见错误

**错误**: `PAYLOAD_SECRET is missing`
- **解决**: 检查 `.env` 文件是否存在且包含 `PAYLOAD_SECRET`

**错误**: `MongoDB connection failed`
- **解决**: 确保 MongoDB 服务正在运行，检查 `MONGODB_URL` 配置

**错误**: `RESEND_API_KEY is missing`
- **解决**: 检查 `.env` 文件中的 `RESEND_API_KEY` 配置

**错误**: `ValidationError: 以下字段是无效的： user`
- **解决**: 确保在创建订单时传递了 `req` 对象，且用户已认证

### 11.2 调试技巧

1. 检查环境变量是否加载：
   ```typescript
   console.log('RESEND_API_KEY', process.env.RESEND_API_KEY)
   ```

2. 检查 Payload 用户上下文：
   ```typescript
   console.log('req.user', req.user)
   ```

3. 检查 Stripe 是否启用：
   ```typescript
   console.log('Stripe enabled:', isStripeEnabled())
   ```

---

## 12. 版本信息

- **项目**: DigitalHippo
- **框架**: Next.js 14, Payload CMS, tRPC
- **数据库**: MongoDB
- **支付**: Stripe (可选)
- **邮件**: Resend

---

**文档维护**: 请在每次重要改动后更新此文档。

