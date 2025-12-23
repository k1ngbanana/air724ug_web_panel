# SQLite 数据库使用说明

## 📦 项目结构

```
server/
├── db/
│   ├── init.ts              # 数据库初始化脚本
│   └── database.sqlite      # SQLite数据库文件（自动生成）
├── services/
│   ├── userService.ts       # 用户服务
│   ├── deviceService.ts     # 设备服务
│   └── activationService.ts # 激活码服务
└── README.md                # 本文档
```

## 🚀 快速开始

### 1. 安装依赖

已自动安装：
- `better-sqlite3` - SQLite数据库驱动
- `@types/better-sqlite3` - TypeScript类型定义

### 2. 数据库初始化

数据库会在首次导入时自动初始化，包含：

**默认账号**：
- 管理员：`admin / admin123`
- 测试用户：`123456 / 123456`

**默认激活码**：
- `TEST-2024-ABCD` - 10次使用，2025-12-31过期
- `DEMO-2024-EFGH` - 5次使用，2025-06-30过期

### 3. 数据库位置

```
web/server/db/database.sqlite
```

## 📊 数据表结构

### users 表
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  email TEXT,
  role TEXT DEFAULT 'user',           -- 'admin' | 'user'
  status TEXT DEFAULT 'active',        -- 'active' | 'inactive'
  need_activation INTEGER DEFAULT 0,   -- 0=已激活, 1=需要激活
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### devices 表
```sql
CREATE TABLE devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imei TEXT UNIQUE NOT NULL,
  phone TEXT,
  iccid TEXT,
  signal INTEGER,
  operator TEXT,
  connected INTEGER DEFAULT 0,         -- 0=离线, 1=在线
  last_seen DATETIME,
  owner TEXT,                          -- 绑定的用户名
  FOREIGN KEY (owner) REFERENCES users(username)
)
```

### activation_keys 表
```sql
CREATE TABLE activation_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',        -- 'active' | 'disabled'
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### activation_usage 表
```sql
CREATE TABLE activation_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  username TEXT NOT NULL,
  used_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

## 🔧 服务层 API

### userService

```typescript
// 用户注册
userService.register(username, password, email?, needActivation?)

// 用户登录
userService.login(username, password)

// 获取所有用户
userService.getAllUsers()

// 更新用户信息
userService.updateUser(username, { currentPassword?, newPassword?, email? })

// 激活用户
userService.activateUser(username)
```

### deviceService

```typescript
// 获取所有设备（管理员）
deviceService.getAllDevices()

// 获取用户设备
deviceService.getUserDevices(username)

// 添加设备（WebSocket连接时）
deviceService.addDevice({ imei, phone?, iccid?, signal?, operator? })

// 更新设备状态
deviceService.updateDeviceStatus(imei, connected)

// 绑定设备
deviceService.bindDevice(imei, username)

// 解绑设备
deviceService.unbindDevice(imei, username)
```

### activationService

```typescript
// 获取所有激活码
activationService.getAllKeys()

// 创建激活码
activationService.createKey({ code, description?, maxUses?, expiresAt? })

// 验证激活码
activationService.validateKey(code)

// 使用激活码
activationService.useKey(code, username)

// 更新激活码状态
activationService.updateKeyStatus(code, status)
```

## 🔄 Mock API 集成

Mock文件已自动使用SQLite：`mock/modules/user.mock.ts`

所有API请求现在都会操作真实的SQLite数据库。

## 📝 数据持久化

✅ **数据会持久化保存**
- 用户注册的账号会保存到数据库
- 设备绑定关系会保存到数据库
- 激活码使用记录会保存到数据库

✅ **服务器重启后数据不丢失**
- 数据库文件 `database.sqlite` 会保留
- 重启后所有数据自动恢复

## 🗑️ 重置数据库

如果需要重置数据库：

```bash
# 删除数据库文件
rm server/db/database.sqlite

# 重启开发服务器，数据库会自动重新初始化
pnpm dev
```

## 🔍 查看数据库

推荐使用以下工具查看数据库：

1. **DB Browser for SQLite** (推荐)
   - 下载：https://sqlitebrowser.org/
   - 打开 `server/db/database.sqlite`

2. **VSCode 插件**
   - SQLite Viewer
   - SQLite

3. **命令行**
   ```bash
   sqlite3 server/db/database.sqlite
   ```

## 🚨 注意事项

1. **密码安全**：当前密码为明文存储，生产环境需要使用bcrypt等加密
2. **Token管理**：当前使用简单的内存映射，生产环境需要使用JWT
3. **并发控制**：SQLite适合中小型项目，大并发建议使用MySQL/PostgreSQL
4. **备份策略**：定期备份 `database.sqlite` 文件

## 📈 下一步

- [ ] 实现WebSocket服务，自动添加连接的设备
- [ ] 添加密码加密（bcrypt）
- [ ] 实现真实的JWT token
- [ ] 添加数据库迁移工具
- [ ] 实现设备数据实时更新
