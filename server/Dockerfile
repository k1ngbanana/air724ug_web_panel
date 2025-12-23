FROM node:20-alpine

WORKDIR /app

# 安装编译依赖（better-sqlite3需要）
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite \
    sqlite-dev \
    build-base

# 复制package.json和package-lock.json
COPY package*.json ./

# 清理可能存在的node_modules和重新安装
RUN npm ci --production && \
    npm rebuild better-sqlite3

# 复制源代码
COPY . .

# 创建数据和public目录
RUN mkdir -p /app/data /app/public

# 暴露端口
EXPOSE 9527

# 启动应用
CMD ["npm", "start"]
