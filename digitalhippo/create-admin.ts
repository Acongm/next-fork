import { getPayloadClient } from './src/get-payload'

async function createAdmin() {
  const payload = await getPayloadClient()

  try {
    // 检查是否已有管理员
    const { docs: admins } = await payload.find({
      collection: 'users',
      where: {
        role: {
          equals: 'admin',
        },
      },
    })

    if (admins.length > 0) {
      console.log('管理员账号已存在:')
      admins.forEach((admin) => {
        console.log(`- ${admin.email}`)
      })
      process.exit(0)
    }

    // 创建管理员账号
    const email = process.argv[2] || 'admin@example.com'
    const password = process.argv[3] || 'admin123'

    const admin = await payload.create({
      collection: 'users',
      data: {
        email,
        password,
        role: 'admin',
        _verified: true, // 跳过邮箱验证
      },
    })

    console.log('✅ 管理员账号创建成功!')
    console.log(`📧 邮箱: ${admin.email}`)
    console.log(`🔑 密码: ${password}`)
    console.log(`\n现在可以使用这些凭据登录 http://localhost:3000/sell`)
  } catch (error) {
    console.error('❌ 创建管理员失败:', error)
    process.exit(1)
  }

  process.exit(0)
}

createAdmin()

