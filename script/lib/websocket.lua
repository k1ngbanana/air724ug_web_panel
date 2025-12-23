-- 模块功能：websocket客户端（修复coroutine mismatch错误）
-- @module websocket
-- @author wendal
-- @license MIT
-- @copyright OpenLuat.com
-- @release 2023.09.18
require "utils"
require "socket"
module(..., package.seeall)

local magic = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

local ws = {}
ws.__index = ws
local function websocket(url, cert)
    return setmetatable({
        io = nil,
        url = url,
        key = "",
        wss = "",
        cert = cert,
        host = "",
        port = "",
        input = "",
        callbacks = {},
        send_data = {},
        send_text = nil,
        sendsize = 1460,
        open_callback = false,
        connected = false,
        terminated = false,
        readyState = "CONNECTING",
        keepAlivetimer = nil,
        send_queue = {}  -- 添加发送队列来解决协程问题
    }, ws)
end

function new(url, cert)
    return websocket(url, cert)
end

function ws:on(event, callback)
    self.callbacks[event] = callback
end

function ws:connect(timeout)
    self.wss, self.host, self.port, self.path = self.url:match("(%a+)://([%w%.%-]+):?(%d*)(.*)")
    self.wss, self.host = self.wss:lower(), self.host:lower()
    self.port = self.port ~= "" and self.port or (self.wss == "wss" and 443 or 80)
    if self.wss == "wss" then
        self.io = socket.tcp(true, self.cert)
    else
        self.io = socket.tcp()
    end
    if not self.io then
        log.error("websocket:connect:", "没有可用的TCP通道!")
        return false
    end
    if not self.io:connect(self.host, self.port, timeout) then
        log.error("websocket:connect", "服务器连接失败!")
        return false
    end
    self.key = crypto.base64_encode(math.random(100000000000000, 999999999999999) .. 0, 16)
    local req = "GET " .. self.path .. " HTTP/1.1\r\nHost: " .. self.host .. ":" .. self.port .. "\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" .. "Origin: http://" .. self.host ..
                    "\r\nSec-WebSocket-Version: 13\r\n" .. "Sec-WebSocket-Key: " .. self.key .. "\r\n\r\n"
    if self.io:send(req, tonumber(timeout) or 20000) then
        local r, s = self.io:recv(tonumber(timeout) or 5000)
        if not r then
            self.io:close()
            log.error("websocket:connect", "与 websocket server 握手超时!")
            return false
        end
        local _, idx, code = s:find("%s(%d+)%s.-\r\n")
        if code == "101" then
            local header, accept = {}, self.key .. magic
            accept = crypto.sha1(accept, #accept):fromHex()
            accept = crypto.base64_encode(accept, #accept)
            for k, v in string.gmatch(s:sub(idx + 1, -1), "(.-):%s*(.-)\r\n") do
                header[k:lower()] = v
            end
            if header["sec-websocket-accept"] and header["sec-websocket-accept"] == accept then
                log.info("websocket:connect", "与 websocket server 握手成功!")
                self.connected, self.readyState = true, "OPEN"
                if self.callbacks.open then
                    self.open_callback = true
                end
                return true
            end
        end
    end
    log.error("websocket:connect", "与 websocket server 握手失败!")
    return false
end

-- 掩码加密
local function wsmask(mask, data)
    local i = 0
    return data:gsub(".", function(c)
        i = i + 1
        return string.char(bit.bxor(data:byte(i), mask:byte((i - 1) % 4 + 1)))
    end)
end

-- 修复：通过发送队列避免协程问题
function ws:sendFrame(fin, opcode, data)
    if not self.connected then
        return
    end
    
    local finbit, maskbit, len = fin and 0x80 or 0, 0x80, #data
    local frame = pack.pack("b", bit.bor(finbit, opcode))
    if len < 126 then
        frame = frame .. pack.pack("b", bit.bor(len, maskbit))
    elseif len < 0xFFFF then
        frame = frame .. pack.pack(">bH", bit.bor(126, maskbit), len)
    else
        log.error("ws:sendFrame", "数据长度超过最大值!")
        return
    end
    local mask = pack.pack(">I", os.time())
    frame = frame .. mask .. wsmask(mask, data)
    
    -- 将数据添加到发送队列，由主任务处理
    table.insert(self.send_queue, frame)
    sys.publish("WEBSOCKET_SEND_DATA", "send")
    return true
end

-- 处理发送队列中的数据
local function process_send_queue(ws)
    while #ws.send_queue > 0 do
        local frame = table.remove(ws.send_queue, 1)
        for i = 1, #frame, ws.sendsize do
            local chunk = frame:sub(i, i + ws.sendsize - 1)
            if not ws.io:send(chunk) then
                log.error("ws:process_send_queue", "发送数据失败")
                break
            end
        end
    end
end

-- 修复：正确的ping函数实现
function ws:ping()
    if self.connected then
        self:sendFrame(true, 0x9, "")
        log.info("websocket: ping sent")
    end
end

-- 修复：正确的pong函数实现
function ws:pong(data)
    if self.connected then
        self:sendFrame(true, 0xA, data or "")
        log.info("websocket: pong sent")
    end
end

function ws:send(data, text)
    if text then
        log.info("websocket client send:", data:sub(1, 66))
        self:sendFrame(true, 0x1, data)
    else
        self:sendFrame(true, 0x2, data)
    end
    if self.callbacks.sent then
        self.callbacks.sent()
    end
end

local function uplink(ws)
    process_send_queue(ws) -- 处理发送队列
end

function ws:recvFrame()
    uplink(self) -- 处理待发送数据
    local close_ctrl = "EXIT_TASK" .. self.io.id
    local r, s, p = self.io:recv(5000, "WEBSOCKET_SEND_DATA")
    if not r then
        if s == "timeout" then
            return false, nil, "WEBSOCKET_OK"
        elseif s == "WEBSOCKET_SEND_DATA" then
            if p == "send" then -- 主动上报
                uplink(self)
            elseif p == "ping" then -- 本地心跳上行
                self:ping()
            elseif p == "pong" then -- 服务器心跳下行,马上回应
                self:pong("")
            elseif p == close_ctrl then
                return false, nil, close_ctrl
            end
            return false, nil, "WEBSOCKET_OK"
        else
            return false, nil, "Read byte error!"
        end
    end
    if #self.input ~= 0 then
        s = self.input .. s
    end
    local _, firstByte, secondByte = pack.unpack(s:sub(1, 2), "bb")
    local fin = bit.band(firstByte, 0x80) ~= 0
    local rsv = bit.band(firstByte, 0x70) ~= 0
    local opcode = bit.band(firstByte, 0x0f)
    local isControl = bit.band(opcode, 0x08) ~= 0
    -- 检查RSV1,RSV2,RSV3 是否为0,客户端不支持扩展
    if rsv then
        return false, nil, "服务器正在使用未定义的扩展!"
    end
    -- 检查数据是否存在掩码加密
    local maskbit = bit.band(secondByte, 0x80) ~= 0
    local length = bit.band(secondByte, 0x7f)
    if isControl and (length >= 126 or not fin) then
        return false, nil, "控制帧异常!"
    end
    if maskbit then
        return false, nil, "数据帧被掩码处理过!"
    end
    -- 获取载荷长度
    if length == 126 then
        _, length = pack.unpack(s:sub(3, 4), ">H")
    elseif length == 127 then
        return false, nil, "数据帧长度超过支持范围!"
    end
    -- 获取有效载荷数据
    if length > 0 then
        if length > 126 then
            if #s < length + 4 then
                self.input = s
                return true, false, ""
            end
            s = s:sub(5, 5 + length - 1)
        else
            s = s:sub(3, 3 + length - 1)
        end
    end
    -- 处理切片帧
    if not fin then -- 切片未完成
        return true, false, s
    else -- 未分片帧
        if opcode < 0x3 then -- 数据帧
            self.input = ""
            return true, true, s
        elseif opcode == 0x8 then -- close
            local code, reason
            if #s >= 2 then
                _, code = pack.unpack(s:sub(1, 2), ">H")
            end
            if #s > 2 then
                reason = s:sub(3)
            end
            self.terminated = true
            self.input = ""
            return false, nil, reason
        elseif opcode == 0x9 then -- Ping
            self:pong(s or "")
        elseif opcode == 0xA then -- Pong
            if self.callbacks.pong then
                self.callbacks.pong(s)
            end
        end
        self.input = ""
        return true, true, nil
    end
end

function ws:recv()
    local data = ""
    while true do
        local success, final, message = self:recvFrame()
        -- 数据帧解析错误
        if not success then
            return success, message
        end
        -- 数据帧分片处理
        if message then
            data = data .. message
        else
            data = "" -- 数据帧包含控制帧处理
        end
        -- 数据帧处理完成
        if final and message then
            break
        end
    end
    if self.callbacks.message then
        self.callbacks.message(data)
    end
    return true, data
end

function ws:close(code, reason)
    self.readyState = "CLOSING"
    if self.terminated then
        log.error("ws:close server code:", code, reason)
    elseif self.io.connected then
        if code == nil and reason ~= nil then
            code = 1000
        end
        local data = ""
        if code ~= nil then
            data = pack.pack(">H", code)
        end
        if reason ~= nil then
            data = data .. reason
        end
        self.terminated = true
        self:sendFrame(true, 0x8, data)
    end
    if self.keepAlivetimer then
        sys.timerStop(self.keepAlivetimer)
        self.keepAlivetimer = nil
    end
    self.io:close()
    self.readyState, self.connected = "CLOSED", false
    if self.callbacks.close then
        self.callbacks.close(code or 1001)
    end
    self.input = ""
end

function exit(ws)
    sys.publish("WEBSOCKET_SEND_DATA", "EXIT_TASK" .. ws.io.id)
end

function ws:state()
    return self.readyState
end

function ws:online()
    return self.connected
end

-- 修复：在主任务中处理心跳，避免协程问题
function ws:start(keepAlive, proc, reconnTime)
    reconnTime = tonumber(reconnTime) and reconnTime * 1000 or 1000
    local pingInterval = (keepAlive and keepAlive * 1000) or 30000
    
    while true do
        while not socket.isReady() do
            sys.wait(1000)
        end
        if self:connect() then
            if self.open_callback == true then
                self.callbacks.open()
                self.open_callback = false
            end
            
            -- 启动心跳定时器，但只发送信号，实际发送在主任务中进行
            self.keepAlivetimer = sys.timerLoopStart(function() 
                sys.publish("WEBSOCKET_SEND_DATA", "ping")
            end, pingInterval)
            
            local close_ctrl = "EXIT_TASK" .. self.io.id
            repeat
                local r, message = self:recv()
                if r then
                    if type(proc) == "function" then
                        proc(message)
                    end
                elseif message == close_ctrl then
                    self:close()
                    if self.keepAlivetimer then
                        sys.timerStop(self.keepAlivetimer)
                        self.keepAlivetimer = nil
                    end
                    if self.io.id ~= nil then
                        self = nil
                    end
                    return true
                elseif not r and message ~= "WEBSOCKET_OK" then
                    log.error('ws recv error', message)
                end
            until not r and message ~= "WEBSOCKET_OK"
            
            if self.keepAlivetimer then
                sys.timerStop(self.keepAlivetimer)
                self.keepAlivetimer = nil
            end
        end
        self:close()
        log.info("websocket:Start", "与 websocket Server 的连接已断开!")
        sys.wait(reconnTime)
    end
end



