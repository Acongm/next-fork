require('dotenv').config({ path: '.env' })
const mongoose = require('mongoose')

async function createAdmin() {
  const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017/digitalhippo'
  
  try {
    await mongoose.connect(mongoUrl)
    console.log('✅ 已连接到 MongoDB')

    const User = mongoose.model('users', new mongoose.Schema({}, { strict: false }))

    // 删除之前创建的错误账号
    await User.deleteMany({ email: 'admin@example.com' })
    console.log('🗑️  已删除之前创建的账号')

    // 先通过前端注册一个账号，然后我们将其改为管理员
    // 或者，我们可以使用 Payload 的 API 来创建
    console.log('\n请按照以下步骤操作：')
    console.log('1. 访问 http://localhost:3000/sign-up 注册一个账号')
    console.log('2. 注册完成后，告诉我你的邮箱地址')
    console.log('3. 我会将该账号设置为管理员\n')

    // 或者，如果用户已经注册了，可以直接修改
    const email = process.argv[2]
    if (email) {
      const user = await User.findOne({ email })
      if (user) {
        user.role = 'admin'
        user._verified = true
        await user.save()
        console.log(`✅ 已将 ${email} 设置为管理员`)
        console.log(`现在可以使用该账号登录 http://localhost:3000/sell`)
      } else {
        console.log(`❌ 未找到邮箱为 ${email} 的用户`)
      }
    }
  } catch (error) {
    console.error('❌ 操作失败:', error.message)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
  }
}

createAdmin()

