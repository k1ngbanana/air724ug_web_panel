local websocket = require "websocket"
local log = require "log"
local sys = require "sys"
local misc = require "misc"
local util_mobile = require "util_mobile"
local util_notify = require "util_notify"
local util_temperature = require "util_temperature"
local net = require "net"
local nvm = require "nvm"
local ril = require "ril"
local sms = require "sms"
local pmd = require "pmd"

config = nvm.para

local function parse_config(config_text)
    -- 参数检查
    if type(config_text) ~= "string" or config_text == "" then
        return nil, "配置文本不能为空"
    end

    -- 预处理配置文本
    local processed_text = config_text:gsub("module%(%.%.%.%)", ""):gsub("%-%-[^\n]*", ""):gsub("\n%s*\n", "\n")

    -- 创建一个环境table来捕获配置变量
    local env = {}
    local chunk = loadstring(processed_text)
    if chunk then
        setfenv(chunk, env)
        chunk()
    else
        log.info("set_config", "Failed to parse_config")
    end

    return env
end

local function handleTask(ws, json_data)

    log.info("websocket", json_data.task)

    -- 处理task类型的消息
    if json_data.type == "task" and json_data.taskId then
        -- 执行对应的task函数
        sys.taskInit(function()
            local result = nil
            local error = nil

            -- 执行task函数
            local success, err = pcall(function()
                -- 根据taskid执行不同的任务
                if json_data.task == "get_temperature" then
                    -- 调用温度查询函数
                    result = util_temperature.get()
                elseif json_data.task == "at_cmd" then
                    -- 检查参数
                    if not json_data.command then
                        error = "缺少必要参数: command"
                    else
                        -- 执行AT指令
                        local response = ""
                        local taskId = json_data.taskId
                        
                        -- 使用一个全局的响应处理函数
                        local function atResponseHandler(cmd, success, resp, inter)
                            if inter then
                                response = response .. inter .. "\n"
                            end
                            if resp then
                                response = response .. resp
                            end
                            
                            -- 发送执行结果给服务端
                            local response_data = {
                                type = "task_result",
                                taskId = taskId,
                                task = json_data.task,
                                result = response,
                                error = nil
                            }
                            ws:send(json.encode(response_data), true)
                        end
                        
                        -- 发送AT指令，直接使用回调函数
                        ril.request(json_data.command, nil, atResponseHandler)
                        -- 提前返回，等待回调处理
                        return
                    end
                elseif json_data.task == "send_sms" then
                    -- 检查参数
                    if not json_data.rcv_phone or not json_data.content then
                        error = "缺少必要参数: rcv_phone 或 content"
                    else
                        local sms_success, sms_err = pcall(function()
                            sms.send(json_data.rcv_phone, json_data.content)
                        end)
                        if sms_success then
                            result = "短信发送成功"
                        else
                            error = "短信发送失败: " .. tostring(sms_err)
                        end
                    end
                elseif json_data.task == "read_sms" then
                    -- 读取短信历史记录
                    local file = io.open("/usbmsc0/sms_history.txt", "r")
                    if file then
                        local content = file:read("*a")
                        file:close()

                        -- 解析短信内容
                        local sms_list = {}
                        if content and content ~= "" then
                            for line in content:gmatch("[^\r\n]+") do
                                -- 格式: datetime\tsender\treceiver\tcontent
                                local datetime, sender, receiver, sms_content = line:match("([^\t]*)\t([^\t]*)\t([^\t]*)\t(.*)")
                                if datetime and sender and sms_content then
                                    -- 还原转义的换行符
                                    sms_content = sms_content:gsub("\\r", "\r"):gsub("\\n", "\n")
                                    table.insert(sms_list, {
                                        datetime = datetime,
                                        sender = sender,
                                        receiver = receiver,
                                        content = sms_content
                                    })
                                end
                            end
                        end

                        -- 按时间倒序排列（最新的在前）
                        table.sort(sms_list, function(a, b)
                            return a.datetime > b.datetime
                        end)

                        result = sms_list
                    else
                        error = "无法读取短信历史文件或文件不存在"
                    end
                elseif json_data.task == "get_config" then
                    -- 直接读取/nvm_para.lua文件内容
                    local file = io.open("/nvm_para.lua", "r")
                    if file then
                        local content = file:read("*a")
                        file:close()
                        result = content
                    else
                        error = "无法读取/nvm_para.lua文件"
                    end
                elseif json_data.task == "set_config" then
                    -- 兼容两种格式：
                    -- 1) 旧格式：直接传一个 configs 表
                    -- 2) 新格式：传 configText 文本，由设备端解析为 configs 表

                    local configs = nil

                    if json_data.configs and type(json_data.configs) == "table" then
                        -- 旧格式：直接使用传入的 table
                        configs = json_data.configs
                    elseif json_data.configText and type(json_data.configText) == "string" then
                        -- 新格式：从 configText 文本解析出配置表
                        local env, perr = parse_config(json_data.configText)
                        if not env then
                            error = perr or "配置解析失败"
                        else
                            configs = env
                        end
                    else
                        error = "缺少必要参数: configs 或 configText"
                    end

                    if not error and configs and type(configs) == "table" then
                        local success_count = 0
                        local fail_count = 0
                        local fail_reasons = {}

                        -- 遍历所有配置项
                        for key, value in pairs(configs) do
                            -- 检查key是否符合命名规范
                            if not key:match("^[A-Z_]+$") then
                                fail_count = fail_count + 1
                                fail_reasons[key] = "配置项名称必须全大写字母和下划线组成"
                            else
                                -- 设置config变量
                                config[key] = value
                                -- 保存到NVM
                                nvm.set(key, value)
                                success_count = success_count + 1

                                -- 如果修改了特定配置，需要立即生效
                                if key == "LED_ENABLE" then
                                    if value then
                                        pmd.ldoset(2, pmd.LDO_VLCD)
                                    end
                                elseif key == "RNDIS_ENABLE" then
                                    ril.request("AT+RNDISCALL=" .. (value and 1 or 0) .. ",0")
                                end
                            end
                        end

                        -- 保存NVM
                        nvm.flush()

                        -- 按大货版行为，将原始 configText 写回 /nvm_para.lua，保留完整注释与结构
                        if json_data.configText and type(json_data.configText) == "string" then
                            local file = io.open("/nvm_para.lua", "w+")
                            if file then
                                file:write(json_data.configText)
                                file:close()
                            else
                                error = "无法写入/nvm_para.lua文件"
                            end
                        end

                        -- 设置返回结果
                        if not error then
                            result = {
                                success_count = success_count,
                                fail_count = fail_count,
                                fail_reasons = fail_reasons
                            }
                        end
                    end
                else
                    error = "未知的任务类型: " .. (json_data.task or "nil")
                end
            end)
            
            if not success then
                error = err
            end

            -- 发送执行结果给服务端
            local response = { type = "task_result", taskId = json_data.taskId, task = json_data.task, result = result, error = error }

            if not error then
                log.info('websocket', error)
            end

            ws:send(json.encode(response), true)
        end)
    end
end

-- 应用层心跳间隔(秒)，与服务器 HEARTBEAT_TIMEOUT(150s) 对应
local HEARTBEAT_INTERVAL = 60

-- 当前 WebSocket 的心跳定时器句柄
local heartbeatTimer

local function startWebSocket()

    log.info("websocket", "开始连接")

    -- websocket 连接
    -- 使用 config.WEBSOCKET_URL 获取地址
    local ws = websocket.new(config.WEBSOCKET_URL)

    ws:on("open", function()
        log.info("websocket", "连接已打开")

        -- 计算一次当前状态, 用于首次上线的 online 消息
        local uptime
        if rtos and type(rtos.tick) == "function" then
            local ms = (rtos.tick() or 0) * 5
            local sec = math.floor(ms / 1000)
            local h = math.floor(sec / 3600)
            local m = math.floor((sec % 3600) / 60)
            local s = sec % 60
            uptime = string.format("%02d:%02d:%02d", h, m, s)
        end

        local rsrpStr
        if net and type(net.getRsrp) == "function" then
            local rsrp = net.getRsrp()
            if rsrp then
                -- 将模组返回的 RSRP 指标转换为 dBm（约 rsrp - 140），得到负值，如 -96 dB
                local dbm = rsrp - 140
                rsrpStr = string.format("%d dB", dbm)
            end
        end

        local oper = util_mobile.getOper and util_mobile.getOper(true) or nil

        local vbattStr
        local vbatt = misc.getVbatt and misc.getVbatt() or nil
        if vbatt and vbatt ~= "" then
            vbattStr = string.format("%.3f V", vbatt / 1000)
        end

        local tempStr
        local t = util_temperature.get and util_temperature.get() or nil
        if t and t ~= "-99" then
            local tv = tonumber(t)
            if tv then
                -- 只上传纯数值, 单位在前端展示时再追加, 避免重复单位
                tempStr = tonumber(string.format("%.2f", tv))
            end
        end

        local band
        if net and type(net.getBand) == "function" then
            band = net.getBand()
        end

        -- 首次上线的完整 online 数据
        local json_data = {
            type = "online",
            imei = misc.getImei(),
            phone = util_mobile.getNumber(),
            ver = VERSION,
            uptime = uptime,
            rsrp = rsrpStr,
            oper = oper,
            vbatt = vbattStr,
            temperature = tempStr,
            band = band,
        }
        ws:send(json.encode(json_data), true)

        -- 启动应用层心跳: 定期向服务器发送 device_status JSON
        if heartbeatTimer then
            sys.timerStop(heartbeatTimer)
            heartbeatTimer = nil
        end
        heartbeatTimer = sys.timerLoopStart(function()
            if ws and ws:online() then
                -- 运行总时长（秒），基于系统 tick 计算
                local uptime
                if rtos and type(rtos.tick) == "function" then
                    local ms = (rtos.tick() or 0) * 5
                    local sec = math.floor(ms / 1000)
                    local h = math.floor(sec / 3600)
                    local m = math.floor((sec % 3600) / 60)
                    local s = sec % 60
                    uptime = string.format("%02d:%02d:%02d", h, m, s)
                end

                -- 信号强度，使用 RSRP 转换为 dBm（负值）
                local rsrpStr
                if net and type(net.getRsrp) == "function" then
                    local rsrp = net.getRsrp()
                    if rsrp then
                        local dbm = rsrp - 140
                        rsrpStr = string.format("%d dB", dbm)
                    end
                end

                -- 运营商中文名
                local oper = util_mobile.getOper and util_mobile.getOper(true) or nil

                -- 电池电压（单位：V）
                local vbattStr
                local vbatt = misc.getVbatt and misc.getVbatt() or nil
                if vbatt and vbatt ~= "" then
                    vbattStr = string.format("%.3f V", vbatt / 1000)
                end

                -- 温度（数值，不带单位）
                local tempStr
                local t = util_temperature.get and util_temperature.get() or nil
                if t and t ~= "-99" then
                    local tv = tonumber(t)
                    if tv then
                        tempStr = tonumber(string.format("%.2f", tv))
                    end
                end

                local status = {
                    type = "device_status",
                    imei = misc.getImei(),
                    ver = VERSION,
                    uptime = uptime,
                    rsrp = rsrpStr,
                    oper = oper,
                    vbatt = vbattStr,
                    temperature = tempStr,
                }

                ws:send(json.encode(status), true)
                log.info("websocket", "device_status sent")
            end
        end, HEARTBEAT_INTERVAL * 1000)
    end)

    ws:on("message", function(data)
        -- 解析JSON数据
        local success, json_data = pcall(json.decode, data)
        if success then
            handleTask(ws, json_data)
        end
    end)

    ws:on("close", function()
        log.info("websocket", "连接关闭")
        if heartbeatTimer then
            sys.timerStop(heartbeatTimer)
            heartbeatTimer = nil
        end
    end)

    ws:on("error", function(ws, err)
        log.error("websocket", "连接错误", err)
        if heartbeatTimer then
            sys.timerStop(heartbeatTimer)
            heartbeatTimer = nil
        end
    end)

    -- 启动WebSocket任务
    ws:start(60)
end

return { start = startWebSocket }
