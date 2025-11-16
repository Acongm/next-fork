require('dotenv').config({ path: '.env' })
const mongoose = require('mongoose')
const crypto = require('crypto')

async function createAdmin() {
  const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017/digitalhippo'
  
  try {
    await mongoose.connect(mongoUrl)
    console.log('✅ 已连接到 MongoDB')

    const User = mongoose.model('users', new mongoose.Schema({}, { strict: false }))

    // 检查是否已有管理员
    const existingAdmin = await User.findOne({ role: 'admin' })
    if (existingAdmin) {
      console.log('管理员账号已存在:')
      console.log(`- 邮箱: ${existingAdmin.email}`)
      process.exit(0)
    }

    // 创建管理员账号
    const email = process.argv[2] || 'admin@example.com'
    const password = process.argv[3] || 'admin123'

    // 生成 salt 和 hash (简化版本，Payload 使用更复杂的加密)
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex')

    const admin = await User.create({
      email,
      password: hash,
      salt,
      role: 'admin',
      _verified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    console.log('✅ 管理员账号创建成功!')
    console.log(`📧 邮箱: ${admin.email}`)
    console.log(`🔑 密码: ${password}`)
    console.log(`\n现在可以使用这些凭据登录 http://localhost:3000/sell`)
  } catch (error) {
    console.error('❌ 创建管理员失败:', error.message)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
  }
}

createAdmin()

