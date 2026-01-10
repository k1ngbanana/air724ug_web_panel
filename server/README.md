# Air724UG Server - 完整部署指南

## 📦 项目架构

```
server/
├── index.js              # 主服务器文件（HTTP + WebSocket）
├── database.js           # SQLite数据库初始化
├── package.json          # 依赖配置
├── Dockerfile            # Docker构建文件
├── routes/               # API路由
│   ├── auth.js          # 认证相关API
│   ├── device.js        # 设备管理API
│   └── admin.js         # 管理员API
├── data/                 # 数据库文件目录（自动创建）
│   └── database.sqlite  # SQLite数据库
└── public/               # 前端静态文件（需要从web构建）
    └── index.html
```

## 🚀 部署步骤

### 方式1：本地部署（推荐开发使用）

#### 1. 安装依赖

```bash
cd server
npm install
```

#### 2. 构建前端

```bash
cd ../web
pnpm install
pnpm build:pro
```

#### 3. 复制前端文件到server

```bash
# Windows PowerShell
Copy-Item -Path ../web/dist/* -Destination ./public/ -Recurse -Force

# Linux/Mac
cp -r ../web/dist/* ./public/
```

#### 4. 启动服务器

```bash
npm start
```

服务器将在 `http://localhost:9527` 启动

### 方式2：Docker部署（推荐生产使用）

#### 1. 构建前端

```bash
cd web
pnpm build:pro
```

#### 2. 复制前端文件

```bash
# 确保server/public目录存在
mkdir -p ../server/public
cp -r dist/* ../server/public/
```

#### 3. 使用Docker Compose启动

```bash
cd ..
docker-compose up -d
```

### 语音识别（腾讯云 ASR）配置

服务器端不会再在代码中硬编码腾讯云密钥，**只通过环境变量读取配置**。如果未配置，将自动降级为模拟数据模式（不访问真实腾讯云）。

#### 本地运行时配置

在 `server2` 目录下创建 `.env` 文件（不要提交到仓库），示例：

```env
TENCENT_SECRET_ID=你的SecretId
TENCENT_SECRET_KEY=你的SecretKey
TENCENT_REGION=ap-beijing
TENCENT_PROJECT_ID=0
```

然后正常启动：

```bash
npm start
```

启动日志中如果看到：

```text
🔍 检查腾讯云配置状态:
  - SecretId: ✅ 已配置
  - SecretKey: ✅ 已配置
  - ProjectId: ✅ 已配置 (0)
  - Region: ap-beijing
✅ 腾讯云语音识别配置正常，将使用真实API
```

说明语音识别配置已生效。

#### Docker / Docker Compose 中配置

在 Docker 中不要把密钥写进 Dockerfile，而是通过环境变量注入。示例 `docker-compose.yml` 片段：

```yaml
services:
  server2:
    build: ./server2
    ports:
      - "9527:9527"
    env_file:
      - ./server2/.env
```

`./server2/.env` 内容与本地示例一致：

```env
TENCENT_SECRET_ID=你的SecretId
TENCENT_SECRET_KEY=你的SecretKey
TENCENT_REGION=ap-beijing
TENCENT_PROJECT_ID=0
```

或者直接在运行容器时使用 `-e` 传入：

```bash
docker run -d --name air724-server2 \
  -p 9527:9527 \
  -e TENCENT_SECRET_ID=你的SecretId \
  -e TENCENT_SECRET_KEY=你的SecretKey \
  -e TENCENT_REGION=ap-beijing \
  -e TENCENT_PROJECT_ID=0 \
  your-image-name
```

## 📊 数据库说明

### 自动初始化

首次启动时，服务器会自动：
1. 创建 `data` 目录
2. 创建 `database.sqlite` 文件
3. 创建所有必要的数据表
4. 插入默认账号和测试数据

### 默认账号

- **管理员**: `admin / admin123`


### 数据表结构

#### users 表
```sql
- id: 用户ID
- username: 用户名（唯一）
- password: 密码
- email: 邮箱
- role: 角色（admin/user）
- status: 状态（active/inactive）
- need_activation: 是否需要激活
- created_at: 创建时间
```

#### devices 表
```sql
- id: 设备ID
- imei: 设备IMEI（唯一）
- phone: 手机号
- iccid: SIM卡ICCID
- signal: 信号强度
- operator: 运营商
- connected: 连接状态（0/1）
- last_seen: 最后在线时间
- owner: 绑定用户
```

#### activation_keys 表
```sql
- id: 激活码ID
- code: 激活码（唯一）
- description: 描述
- max_uses: 最大使用次数
- used_count: 已使用次数
- status: 状态（active/disabled）
- expires_at: 过期时间
- created_at: 创建时间
```

## 🔌 WebSocket协议

### 设备连接地址

```
ws://your-server:9527/websocket
```

### 消息格式

#### 1. 设备注册
```json
{
  "type": "register",
  "imei": "869298058191404",
  "phone": "15012345678",
  "iccid": "89860123456789012345",
  "signal": 25,
  "operator": "中国移动"
}
```

#### 2. 心跳包
```json
{
  "type": "heartbeat",
  "signal": 28
}
```

#### 3. 数据上报
```json
{
  "type": "data",
  "data": {
    // 自定义数据
  }
}
```

## 📡 API接口

### 认证相关

- `POST /api/auth/login` - 用户登录
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/activate` - 激活账号

### 设备管理

- `GET /api/userPool` - 获取设备列表
- `POST /api/device/bind` - 绑定设备
- `POST /api/device/unbind` - 解绑设备

### 管理员功能

- `GET /api/admin/users` - 获取用户列表
- `GET /api/admin/activation-keys` - 获取激活码列表
- `POST /api/admin/activation-keys` - 创建激活码
- `POST /api/admin/account/update` - 更新账号信息

## 💾 数据备份

### 备份数据库

```bash
# 停止服务器
npm stop

# 备份数据库文件
cp data/database.sqlite data/database.backup.$(date +%Y%m%d).sqlite

# 重启服务器
npm start
```

### 恢复数据库

```bash
# 停止服务器
npm stop

# 恢复数据库
cp data/database.backup.20241109.sqlite data/database.sqlite

# 重启服务器
npm start
```

## 🔧 配置说明

### 端口配置

在 `index.js` 中修改：

```javascript
const PORT = process.env.PORT || 9527
```

或通过环境变量：

```bash
PORT=8080 npm start
```

### 数据库路径

在 `database.js` 中修改：

```javascript
const dbPath = path.join(dataDir, 'database.sqlite')
```

## 📝 日志说明

服务器会输出以下日志：

- `✅` 成功操作
- `📱` 设备连接
- `📴` 设备断开
- `📨` 收到消息
- `❌` 错误信息
- `⚠️` 警告信息

## 🐛 常见问题

### 1. 数据库锁定错误

**原因**: 多个进程同时访问数据库

**解决**: 确保只有一个服务器实例在运行

### 2. 端口被占用

**原因**: 9527端口已被其他程序使用

**解决**: 
```bash
# 查找占用端口的进程
netstat -ano | findstr :9527

# 修改端口或停止占用进程
```

### 3. 前端文件404

**原因**: public目录为空

**解决**: 重新构建并复制前端文件

```bash
cd web
pnpm build:pro
cp -r dist/* ../server/public/
```

## 🔒 安全建议

1. **修改默认密码**: 首次部署后立即修改admin密码
2. **使用HTTPS**: 生产环境建议配置SSL证书
3. **密码加密**: 当前密码为明文，建议使用bcrypt加密
4. **JWT Token**: 当前使用简单token，建议使用JWT
5. **防火墙**: 限制9527端口的访问来源

## 📈 性能优化

1. **数据库索引**: 已在IMEI、username等字段创建索引
2. **连接池**: SQLite使用单连接，适合中小型项目
3. **静态文件缓存**: Nginx可配置静态文件缓存
4. **WebSocket心跳**: 默认30秒心跳，可根据需要调整

## 🆘 技术支持

如有问题，请查看：
1. 服务器日志输出
2. 浏览器控制台
3. 数据库文件是否正常创建
