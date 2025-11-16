import { Access, CollectionConfig } from 'payload/types'
import { BeforeChangeHook } from 'payload/dist/collections/config/types'

const yourOwn: Access = ({ req: { user } }) => {
  if (user.role === 'admin') return true

  return {
    user: {
      equals: user?.id,
    },
  }
}

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

export const Orders: CollectionConfig = {
  slug: 'orders',
  admin: {
    useAsTitle: 'Your Orders',
    description:
      'A summary of all your orders on DigitalHippo.',
  },
  access: {
    read: yourOwn,
    update: ({ req }) => req.user.role === 'admin',
    delete: ({ req }) => req.user.role === 'admin',
    // 允许已认证的用户创建订单（用于支付流程）
    create: ({ req }) => !!req.user,
  },
  hooks: {
    beforeChange: [addUser, setDefaultIsPaid],
  },
  fields: [
    {
      name: '_isPaid',
      type: 'checkbox',
      access: {
        read: ({ req }) => req.user.role === 'admin',
        create: () => false,
        update: () => false,
      },
      admin: {
        hidden: true,
      },
      required: true,
      defaultValue: false,
    },
    {
      name: 'user',
      type: 'relationship',
      admin: {
        hidden: true,
      },
      relationTo: 'users',
      required: true,
      access: {
        create: () => false, // 不允许直接设置，通过 hook 自动设置
        update: () => false,
      },
    },
    {
      name: 'products',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      hasMany: true,
    },
  ],
}
