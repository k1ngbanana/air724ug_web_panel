-- 是否开启录音上传 - 修改为无论什么来电动作都开启录音
local record_enable = true

-- 是否开启企业微信上传
local wechat_work_enable = nvm.get("WECOM_WEBHOOK") and nvm.get("WECOM_WEBHOOK") ~= ""

-- 清理录音文件
local function cleanupRecordFile()
    -- 优先通过 record 模块删除当前录音文件
    local local_file = record.getFilePath() or "/record.amr"
    local ret = record.delete()
    log.info("handler_call.cleanupRecordFile", "尝试通过 record.delete 清理录音文件", "file:", local_file, "result:", ret)

    -- record.delete 返回 true 视为删除成功
    if ret then
        log.info("handler_call.cleanupRecordFile", "录音文件清理成功")
        return
    end

    -- 如果 record.delete 失败或返回 nil/false，再尝试直接删除内部 Flash 根目录下的文件
    if local_file and local_file ~= "" then
        local ok, err = os.remove(local_file)
        if ok then
            log.info("handler_call.cleanupRecordFile", "通过 os.remove 清理录音文件成功", local_file)
        else
            log.warn("handler_call.cleanupRecordFile", "录音文件清理失败或文件不存在", local_file, err)
        end
    else
        log.warn("handler_call.cleanupRecordFile", "没有录音文件路径可供清理")
    end
end


-- 上传任务管理
local upload_tasks = {
    count = 0,
    completed = 0,
    wecom_webhook = false,
    wecom_app = false,
    custom_upload = false
}

-- 检查所有上传任务是否完成，如果完成则清理文件
local function checkAllUploadsComplete()
    upload_tasks.completed = upload_tasks.completed + 1
    log.info("handler_call.checkAllUploadsComplete", "上传任务完成", upload_tasks.completed, "/", upload_tasks.count)
    
    if upload_tasks.completed >= upload_tasks.count then
        log.info("handler_call.checkAllUploadsComplete", "所有上传任务完成，清理录音文件")
        cleanupRecordFile()
        -- 重置计数器
        upload_tasks.count = 0
        upload_tasks.completed = 0
        upload_tasks.wecom_webhook = false
        upload_tasks.wecom_app = false
        upload_tasks.custom_upload = false
    end
end

-- 去除链接最后的斜杠
local function trimSlash(url)
    return string.gsub(url, "/$", "")
end

-- 录音上传接口
local upload_url = nvm.get("UPLOAD_URL") or ""

-- 如果 NVM 中没有配置上传地址，则尝试从 /nvm_para.lua 中解析 UPLOAD_URL
if upload_url == "" then
    local file = io.open("/nvm_para.lua", "r")
    if file then
        local content = file:read("*a")
        file:close()
        if content and content ~= "" then
            -- 匹配形如：UPLOAD_URL = "http://1.2.3.4:9527/api/record"
            local url = content:match("UPLOAD_URL%s*=%s*\"(.-)\"")
            if url and url ~= "" then
                upload_url = url
            end
        end
    end
end

local record_upload_url = trimSlash(upload_url) .. "/api/record"

-- 企业微信webhook地址
local wechat_work_webhook = nvm.get("WECOM_WEBHOOK") or ""

-- 录音格式, 1:pcm 2:wav 3:amrnb 4:speex
local record_format = 3

-- 录音质量, 仅 amrnb 格式有效, 0:一般 1:中等 2:高 3:无损
local record_quality = 2

-- 录音最长时间, 单位秒, 0-50
local record_max_time = 50

-- 通话最长时间, 单位秒
local call_max_time = 300

------------------------------------------------- 初始化及状态记录 --------------------------------------------------

local record_extentions = { [1] = "pcm", [2] = "wav", [3] = "amr", [4] = "speex" }
local record_mime_types = { [1] = "audio/x-pcm", [2] = "audio/wav", [3] = "audio/amr", [4] = "audio/speex" }
local record_extention = record_extentions[record_format]
local record_mime_type = record_mime_types[record_format]

local record_upload_header = { ["Content-Type"] = record_mime_type, ["Connection"] = "keep-alive" }
local record_upload_body = { [1] = { ["file"] = record.getFilePath() } }

CALL_IN = false
CALL_NUMBER = ""

local CALL_CONNECTED_TIME = 0
local CALL_DISCONNECTED_TIME = 0
local CALL_RECORD_START_TIME = 0

local function getCallInAction()
    local call_in_action = nvm.get("CALL_IN_ACTION")
    local has_upload_url = nvm.get("UPLOAD_URL") and nvm.get("UPLOAD_URL") ~= ""
    
    -- 动作为接听, 但录音上传未开启
    if call_in_action == 1 and not has_upload_url then
        return 3
    end
    return call_in_action
end

-- 更新音频配置
-- 用于实现通话时静音, 通话结束时恢复正常, 需要在 callIncoming / callConnected / callDisconnected 回调中调用
-- 注意:
-- 如果通话音量设为0, 通话录音会没有声音
-- 需要切换音频通道来实现通话静音
-- 需实现:
-- 通话时, 忽略扬声器音量, 使用通话音量 (如果扬声器音量大于通话音量, 则使用扬声器音量)
-- 无论是否静音, 自动接听时, 通话录音中呼叫方声音正常
-- 无论是否静音, 手动接听时, 音量均为正常
local function updateAudioConfig(is_call_connected)
    local output_channel = AUDIO_OUTPUT_CHANNEL_NORMAL
    local input_channel = AUDIO_INPUT_CHANNEL_NORMAL

    local call_volume_normal = 5
    local mic_volume_normal = 7

    local audio_volume = nvm.get("AUDIO_VOLUME") or 0
    local call_volume = nvm.get("CALL_VOLUME") or call_volume_normal
    local mic_volume = nvm.get("MIC_VOLUME") or mic_volume_normal

    audio_volume = type(audio_volume) == "string" and tonumber(audio_volume) or audio_volume
    call_volume = type(call_volume) == "string" and tonumber(call_volume) or call_volume
    mic_volume = type(mic_volume) == "string" and tonumber(mic_volume) or mic_volume

    -- 来电动作 无操作 时, 如果手动接听, 并且原音量为0, 则音量设置到正常值
    if is_call_connected and getCallInAction() == 0 then
        if call_volume <= 0 then
            call_volume = call_volume_normal
            -- 手动接听, 如果 audio_volume > call_volume, 则使用 audio_volume
            call_volume = audio_volume > call_volume and audio_volume or call_volume
        end
        if mic_volume <= 0 then
            mic_volume = mic_volume_normal
        end
    end

    -- 修改：无论什么来电动作，都不要静音麦克风，确保录音有声音
    -- 注释掉麦克强制静音，改为调试日志
    if is_call_connected and (getCallInAction() == 1 or getCallInAction() == 3) then
        log.info("handler_call.updateAudioConfig", "原应静音麦克风，但为录音需要保持开启")
        -- mic_volume = 0  -- 注释掉，确保录音有声音
    end

    -- 音量 0 时, 切换静音音频通道, 切换正常音量
    if is_call_connected then
        if call_volume <= 0 then
            call_volume = call_volume_normal
            output_channel = AUDIO_OUTPUT_CHANNEL_MUTE
        end
        if mic_volume <= 0 then
            mic_volume = mic_volume_normal
            input_channel = AUDIO_INPUT_CHANNEL_MUTE
        end
    end

    -- 设置音频通道
    audio.setChannel(output_channel, input_channel)

    -- 设置音量
    audio.setCallVolume(call_volume)
    audio.setMicVolume(mic_volume) -- 测试完全没效果

    -- 设置 mic 增益等级, 通话增益建立成功之后设置才有效
    if is_call_connected then
        audio.setMicGain("call", mic_volume)
        -- 启用录音增益，确保录音音量足够
        audio.setMicGain("record", 7)
        -- 设置通话麦克风增益为最大值
        audio.setMicGain("call", 7)
        log.info("handler_call.updateAudioConfig", "已设置录音增益和通话增益均为7")
    end

    log.info("handler_call.updateAudioConfig", "is_call_connected:", is_call_connected)
    log.info("handler_call.updateAudioConfig", "output_channel:", output_channel, "input_channel:", input_channel)
    log.info("handler_call.updateAudioConfig", "audio_volume:", audio_volume, "call_volume:", call_volume, "mic_volume:", mic_volume)
    log.info("handler_call.updateAudioConfig", "getVolume:" .. audio.getVolume(), "getCallVolume:" .. audio.getCallVolume(), "getMicVolume:" .. audio.getMicVolume())
end

------------------------------------------------- 录音上传相关 --------------------------------------------------

local function recordUploadResultNotify(result, url, msg)
    CALL_DISCONNECTED_TIME = CALL_DISCONNECTED_TIME == 0 and rtos.tick() * 5 or CALL_DISCONNECTED_TIME

    -- 文本通知内容（不包含录音文件）
    local lines = {
        "📞 来电通知",
        "来电号码: " .. CALL_NUMBER,
        "通话时长: " .. (CALL_DISCONNECTED_TIME - CALL_CONNECTED_TIME) / 1000 .. " 秒",
        "录音时长: " .. (result and ((CALL_DISCONNECTED_TIME - CALL_RECORD_START_TIME) / 1000) or 0) .. " 秒",
        "录音结果: " .. (result and "✅ 成功" or ("❌ 失败, " .. (msg or ""))),
        "",
        "#CALL #CALL_RECORD",
    }

    -- 发送文本通知（不包含录音文件）
    util_notify.add(lines)
    
    -- 注意：录音文件会通过 uploadToWechatWork 或其他上传方式直接发送
    -- 这里不再发送文件链接
end

-- 上传录音文件到企业微信
local function uploadToWechatWork(result, msg)
    -- 动态读取企业微信Webhook地址
    local webhook_url = nvm.get("WECOM_WEBHOOK") or ""
    if webhook_url == "" then
        log.error("handler_call.uploadToWechatWork", "未配置企业微信 Webhook")
        return
    end
    
    log.info("handler_call.uploadToWechatWork", "使用企业微信Webhook:", webhook_url)
    
    -- 检查录音文件是否存在
    local file_path = record.getFilePath()
    if not io.exists(file_path) then
        log.error("handler_call.uploadToWechatWork", "录音文件不存在", file_path)
        return
    end
    
    local time = os.time()
    local filename = (CALL_NUMBER or "unknown") .. "_" .. time .. "." .. record_extention
    
    -- 从webhook_url提取上传地址
    -- webhook格式: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxx
    -- 上传格式: https://qyapi.weixin.qq.com/cgi-bin/webhook/upload_media?key=xxxxx&type=voice
    local upload_url = string.gsub(webhook_url, "/send%?", "/upload_media?") .. "&type=voice"
    
    log.info("handler_call.uploadToWechatWork", "上传URL:", upload_url)
    log.info("handler_call.uploadToWechatWork", "文件路径:", file_path)
    
    -- 读取文件数据（二进制安全）
    local file = io.open(file_path, "rb")
    if not file then
        log.error("handler_call.uploadToWechatWork", "无法打开录音文件", file_path)
        return
    end
    local file_data = file:read("*a")
    file:close()
    
    if not file_data or #file_data == 0 then
        log.error("handler_call.uploadToWechatWork", "录音文件为空", file_path)
        return
    end
    
    log.info("handler_call.uploadToWechatWork", "文件大小:", #file_data, "字节")
    
    -- 构建multipart/form-data请求体（使用table拼接，保证二进制安全）
    local boundary = "----WebKitFormBoundary" .. tostring(math.random(100000, 999999))
    local parts = {}
    
    -- 添加各部分（使用table.insert避免字符串拼接导致的二进制数据损坏）
    table.insert(parts, "--" .. boundary .. "\r\n")
    table.insert(parts, 'Content-Disposition: form-data; name="media"; filename="' .. filename .. '\"\r\n')
    table.insert(parts, 'Content-Type: ' .. record_mime_type .. '\r\n')
    table.insert(parts, '\r\n')
    table.insert(parts, file_data)
    table.insert(parts, '\r\n')
    table.insert(parts, '--' .. boundary .. '--\r\n')
    
    -- 使用table.concat拼接（这是Lua中二进制安全的方式）
    local request_body = table.concat(parts)
    
    local headers = {
        ["Content-Type"] = "multipart/form-data; boundary=" .. boundary,
        ["Content-Length"] = tostring(#request_body)
    }
    
    log.info("handler_call.uploadToWechatWork", "请求体大小:", #request_body, "字节")
    
    -- 第一步：上传文件获取media_id
    local function uploadCallback(result, prompt, head, body)
        log.info("handler_call.uploadToWechatWork", "上传返回", result, prompt)
        if body then
            log.info("handler_call.uploadToWechatWork", "body:", body)
        end
        
        if result and prompt == "200" and body then
            -- 解析返回的media_id
            local success, response = pcall(json.decode, body)
            if success and response.errcode == 0 and response.media_id then
                local media_id = response.media_id
                log.info("handler_call.uploadToWechatWork", "获取到media_id:", media_id)
                
                -- 第二步：发送语音消息
                local voice_msg = json.encode({
                    msgtype = "voice",
                    voice = {
                        media_id = media_id
                    }
                })
                
                local function sendCallback(result, prompt, head, body)
                    if result and prompt == "200" then
                        log.info("handler_call.uploadToWechatWork", "录音文件发送到企业微信成功")
                    else
                        log.error("handler_call.uploadToWechatWork", "录音文件发送失败", result, prompt, body)
                    end
                    
                    -- 检查是否所有上传任务都完成
                    checkAllUploadsComplete()
                end
                
                sys.taskInit(http.request, "POST", webhook_url, nil, {["Content-Type"] = "application/json"}, voice_msg, 30000, sendCallback)
            else
                log.error("handler_call.uploadToWechatWork", "解析media_id失败", body)
                -- 检查是否所有上传任务都完成
                checkAllUploadsComplete()
            end
        else
            log.error("handler_call.uploadToWechatWork", "文件上传失败", result, prompt, body)
            -- 检查是否所有上传任务都完成
            checkAllUploadsComplete()
        end
    end
    
    -- 上传文件
    sys.taskInit(http.request, "POST", upload_url, nil, headers, request_body, 60000, uploadCallback)
end

-- 上传录音文件到企业微信应用
local function uploadToWecomApp(result, msg)
    -- 动态读取企业微信应用配置
    local corpid = nvm.get("WECOM_CORPID") or ""
    local corpsecret = nvm.get("WECOM_CORPSECRET") or ""
    local agentid = nvm.get("WECOM_AGENTID") or ""
    
    if corpid == "" or corpsecret == "" or agentid == "" then
        log.error("handler_call.uploadToWecomApp", "企业微信应用配置不完整", "corpid:", corpid ~= "", "corpsecret:", corpsecret ~= "", "agentid:", agentid ~= "")
        return
    end
    
    log.info("handler_call.uploadToWecomApp", "使用企业微信应用发送语音")
    
    -- 获取录音文件路径
    local file_path = record.getFilePath()
    if not file_path or file_path == "" then
        log.error("handler_call.uploadToWecomApp", "无法获取录音文件路径")
        return
    end
    
    -- 第三步：发送语音消息
    local function sendVoiceMessage(access_token, media_id)
        local send_url = "https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=" .. access_token
        
        -- 读取接收人配置
        local touser = nvm.get("WECOM_APP_TOUSER") or "@all"
        
        -- 构建消息体
        local message = {
            touser = touser,
            msgtype = "voice",
            agentid = tonumber(agentid),
            voice = {
                media_id = media_id
            }
        }
        
        local message_body = json.encode(message)
        
        local function sendCallback(result, prompt, head, body)
            if result and prompt == "200" and body then
                local success, response = pcall(json.decode, body)
                if success then
                    if response.errcode == 0 then
                        log.info("handler_call.uploadToWecomApp", "语音消息发送成功")
                    else
                        log.error("handler_call.uploadToWecomApp", "发送失败，错误码:", response.errcode, "错误信息:", response.errmsg)
                    end
                else
                    log.info("handler_call.uploadToWecomApp", "发送结果:", body)
                end
            else
                log.error("handler_call.uploadToWecomApp", "语音消息发送失败", result, prompt, body)
            end
            
            -- 检查是否所有上传任务都完成
            checkAllUploadsComplete()
        end
        
        sys.taskInit(http.request, "POST", send_url, nil, {["Content-Type"] = "application/json"}, message_body, 30000, sendCallback)
    end
    
    -- 第二步：上传临时素材
    local function uploadMedia(access_token)
        local time = os.time()
        local filename = (CALL_NUMBER or "unknown") .. "_" .. time .. "." .. record_extention
        local upload_url = "https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=" .. access_token .. "&type=voice"
        
        log.info("handler_call.uploadToWecomApp", "上传临时素材URL:", upload_url)
        
        -- 读取文件数据
        local file = io.open(file_path, "rb")
        if not file then
            log.error("handler_call.uploadToWecomApp", "无法打开录音文件", file_path)
            return
        end
        local file_data = file:read("*a")
        file:close()
        
        if not file_data or #file_data == 0 then
            log.error("handler_call.uploadToWecomApp", "录音文件为空", file_path)
            return
        end
        
        log.info("handler_call.uploadToWecomApp", "文件大小:", #file_data, "字节")
        
        -- 构建multipart/form-data请求体
        local boundary = "----WebKitFormBoundary" .. tostring(math.random(100000, 999999))
        local parts = {}
        
        table.insert(parts, "--" .. boundary .. "\r\n")
        table.insert(parts, 'Content-Disposition: form-data; name="media"; filename="' .. filename .. '\"\r\n')
        table.insert(parts, 'Content-Type: ' .. record_mime_type .. '\r\n')
        table.insert(parts, '\r\n')
        table.insert(parts, file_data)
        table.insert(parts, '\r\n')
        table.insert(parts, '--' .. boundary .. '--\r\n')
        
        local request_body = table.concat(parts)
        
        local headers = {
            ["Content-Type"] = "multipart/form-data; boundary=" .. boundary,
            ["Content-Length"] = tostring(#request_body)
        }
        
        local function uploadCallback(result, prompt, head, body)
            log.info("handler_call.uploadToWecomApp", "上传返回", result, prompt)
            if body then
                log.info("handler_call.uploadToWecomApp", "body:", body)
            end
            
            if result and prompt == "200" and body then
                local success, response = pcall(json.decode, body)
                if success then
                    if response.media_id then
                        local media_id = response.media_id
                        log.info("handler_call.uploadToWecomApp", "获取到media_id:", media_id)
                        
                        -- 第三步：发送语音消息
                        sendVoiceMessage(access_token, media_id)
                    elseif response.errcode then
                        log.error("handler_call.uploadToWecomApp", "上传失败，错误码:", response.errcode, "错误信息:", response.errmsg)
                        -- 检查是否所有上传任务都完成
                        checkAllUploadsComplete()
                    else
                        log.error("handler_call.uploadToWecomApp", "解析media_id失败", body)
                        -- 检查是否所有上传任务都完成
                        checkAllUploadsComplete()
                    end
                else
                    log.error("handler_call.uploadToWecomApp", "JSON解析失败", body)
                    -- 检查是否所有上传任务都完成
                    checkAllUploadsComplete()
                end
            else
                log.error("handler_call.uploadToWecomApp", "上传临时素材失败", result, prompt, body)
                -- 检查是否所有上传任务都完成
                checkAllUploadsComplete()
            end
        end
        
        sys.taskInit(http.request, "POST", upload_url, nil, headers, request_body, 60000, uploadCallback)
    end
    
    -- 第一步：获取access_token
    local function getAccessToken()
        local token_url = "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=" .. corpid .. "&corpsecret=" .. corpsecret
        
        log.info("handler_call.uploadToWecomApp", "获取access_token", "corpid:", corpid)
        
        local function tokenCallback(result, prompt, head, body)
            log.info("handler_call.uploadToWecomApp", "获取token返回", result, prompt, body)
            if result and prompt == "200" and body then
                local success, response = pcall(json.decode, body)
                if success and response.access_token then
                    local access_token = response.access_token
                    log.info("handler_call.uploadToWecomApp", "获取access_token成功")
                    
                    -- 第二步：上传临时素材
                    uploadMedia(access_token)
                else
                    log.error("handler_call.uploadToWecomApp", "解析access_token失败", body)
                end
            else
                log.error("handler_call.uploadToWecomApp", "获取access_token失败", result, prompt, body)
            end
        end
        
        sys.taskInit(http.request, "GET", token_url, nil, nil, nil, 30000, tokenCallback)
    end
    
    -- 开始执行：获取access_token
    getAccessToken()
end

-- 录音上传结果回调
local function customHttpCallback(url, result, prompt, head, body)
    if result and prompt == "200" then
        log.info("handler_call.customHttpCallback", "录音上传成功", url, result, prompt)
        recordUploadResultNotify(true, url)
    else
        log.error("handler_call.customHttpCallback", "录音上传失败", url, result, prompt, head, body)
        recordUploadResultNotify(false, nil, "录音上传失败")
    end
    
    -- 不在这里清理文件，等待所有上传完成后再清理
end

-- 录音上传
local function upload()
    -- 动态读取企业微信群机器人配置
    local wechat_webhook = nvm.get("WECOM_WEBHOOK") or ""
    local wechat_webhook_enabled = wechat_webhook ~= ""
    
    -- 动态读取企业微信应用配置
    local wecom_corpid = nvm.get("WECOM_CORPID") or ""
    local wecom_corpsecret = nvm.get("WECOM_CORPSECRET") or ""
    local wecom_agentid = nvm.get("WECOM_AGENTID") or ""
    local wecom_app_enabled = wecom_corpid ~= "" and wecom_corpsecret ~= "" and wecom_agentid ~= ""
    
    -- 读取语音发送开关
    local voice_send_enable = nvm.get("VOICE_SEND_ENABLE")
    if voice_send_enable == nil then
        voice_send_enable = false  -- 默认关闭
    end
    voice_send_enable = type(voice_send_enable) == "string" and (voice_send_enable == "true" or voice_send_enable == "1") or voice_send_enable
    
    -- 检查上传URL是否配置
    local upload_url = nvm.get("UPLOAD_URL") or ""
    local upload_url_enabled = upload_url ~= ""
    
    log.info("handler_call.upload", "企业微信群机器人:", wechat_webhook_enabled, "企业微信应用:", wecom_app_enabled, "自定义上传:", upload_url_enabled, "语音发送开关:", voice_send_enable)
    
    -- 初始化上传任务计数器
    upload_tasks.count = 0
    upload_tasks.completed = 0
    upload_tasks.wecom_webhook = false
    upload_tasks.wecom_app = false
    upload_tasks.custom_upload = false
    
    local has_upload = false
    
    -- 1. 如果语音发送开关开启，且配置了企业微信群机器人，则发送语音
    if voice_send_enable and wechat_webhook_enabled then
        log.info("handler_call.upload", "使用企业微信群机器人发送语音")
        upload_tasks.count = upload_tasks.count + 1
        upload_tasks.wecom_webhook = true
        sys.timerStart(function()
            uploadToWechatWork(true, nil)
        end, 2000)
        has_upload = true
    end
    
    -- 2. 如果语音发送开关开启，且配置了企业微信应用，则发送语音
    if voice_send_enable and wecom_app_enabled then
        log.info("handler_call.upload", "使用企业微信应用发送语音")
        upload_tasks.count = upload_tasks.count + 1
        upload_tasks.wecom_app = true
        sys.timerStart(function()
            uploadToWecomApp(true, nil)
        end, 2500)
        has_upload = true
    end
    
    -- 3. 如果配置了自定义上传URL，则上传录音文件
    if upload_url_enabled then
        log.info("handler_call.upload", "上传录音到自定义服务器")
        upload_tasks.count = upload_tasks.count + 1
        upload_tasks.custom_upload = true
        -- 继续执行下面的自定义上传逻辑
        has_upload = true
    else
        -- 如果没有任何上传方式配置
        if not has_upload then
            log.error("handler_call.upload", "未配置任何上传方式")
            recordUploadResultNotify(false, nil, "未配置上传方式")
            -- 没有上传方式也要清理录音文件
            cleanupRecordFile()
            return
        else
            -- 有企业微信上传，但没有自定义上传，直接返回
            recordUploadResultNotify(true, "企业微信", nil)
            -- 企业微信上传会在各自的回调中清理文件，这里不需要清理
            return
        end
    end
    
    -- 自定义上传逻辑
    local local_file = record.getFilePath()
    local time = os.time()
    local date = os.date("*t", time)
    local date_str = string.format("%04d/%02d/%02d %02d:%02d:%02d", date.year, date.month, date.day, date.hour, date.min, date.sec)
    
    -- 获取设备信息
    local imei = misc.getImei() or "unknown"
    local phone = sim.getNumber() or "unknown"
    
    -- 构建POST请求的表单数据
    local boundary = "----WebKitFormBoundary" .. tostring(math.random()):sub(3)
    local form_data = ""
    
    -- 添加设备信息字段
    form_data = form_data .. "--" .. boundary .. "\r\n"
    form_data = form_data .. "Content-Disposition: form-data; name=\"imei\"\r\n\r\n"
    form_data = form_data .. imei .. "\r\n"
    
    form_data = form_data .. "--" .. boundary .. "\r\n"
    form_data = form_data .. "Content-Disposition: form-data; name=\"phone\"\r\n\r\n"
    form_data = form_data .. phone .. "\r\n"
    
    form_data = form_data .. "--" .. boundary .. "\r\n"
    form_data = form_data .. "Content-Disposition: form-data; name=\"callerNumber\"\r\n\r\n"
    form_data = form_data .. CALL_NUMBER .. "\r\n"
    
    form_data = form_data .. "--" .. boundary .. "\r\n"
    form_data = form_data .. "Content-Disposition: form-data; name=\"timestamp\"\r\n\r\n"
    form_data = form_data .. date_str .. "\r\n"
    
    -- 添加文件字段
    local filename = CALL_NUMBER .. "_" .. time .. "." .. record_extention
    form_data = form_data .. "--" .. boundary .. "\r\n"
    form_data = form_data .. "Content-Disposition: form-data; name=\"audio\"; filename=\"" .. filename .. "\"\r\n"
    form_data = form_data .. "Content-Type: " .. record_mime_type .. "\r\n\r\n"
    
    -- 读取文件内容
    local file = io.open(local_file, "rb")
    if not file then
        log.error("handler_call.upload", "无法打开录音文件", local_file)
        recordUploadResultNotify(false, nil, "录音文件读取失败")
        cleanupRecordFile()
        return
    end
    
    local file_data = file:read("*a")
    file:close()
    
    if not file_data or #file_data == 0 then
        log.error("handler_call.upload", "录音文件为空", local_file)
        recordUploadResultNotify(false, nil, "录音文件为空")
        cleanupRecordFile()
        return
    end
    
    -- 完整的请求体
    local request_body = form_data .. file_data .. "\r\n--" .. boundary .. "--\r\n"
    
    -- 设置请求头
    local headers = {
        ["Content-Type"] = "multipart/form-data; boundary=" .. boundary,
        ["Content-Length"] = #request_body,
        ["X-Device-IMEI"] = imei,
        ["Connection"] = "keep-alive"
    }
    
    log.info("handler_call.upload", "上传URL:", record_upload_url)
    log.info("handler_call.upload", "设备IMEI:", imei, "设备号码:", phone, "呼叫号码:", CALL_NUMBER)
    log.info("handler_call.upload", "录音文件路径:", local_file, "文件大小:", #file_data, "字节")

    local function httpCallback(result, prompt, head, body)
        customHttpCallback(record_upload_url, result, prompt, head, body)
        -- 自定义上传完成后检查是否所有任务都完成
        checkAllUploadsComplete()
    end

    sys.taskInit(http.request, "POST", record_upload_url, nil, headers, request_body, 50000, httpCallback)
end

------------------------------------------------- 录音相关 --------------------------------------------------

-- 录音结束回调
local function recordCallback(result, size)
    log.info("handler_call.recordCallback", "录音结束", "result:", result, "size:", size)

    -- 无论什么来电动作，都不自动挂断电话，让通话自然结束
    log.info("handler_call.recordCallback", "录音完成，不自动挂断电话，等待用户手动挂断")
    
    -- 检查录音结果，添加更详细的错误处理
    if result == true then
        log.info("handler_call.recordCallback", "录音成功，准备上传", "result:", result, "size:", size)
        upload()
    elseif result == false then
        log.error("handler_call.recordCallback", "录音失败", "result:", result, "size:", size)
        recordUploadResultNotify(false, nil, "录音失败")
        -- 录音失败也要清理录音文件
        cleanupRecordFile()
    else
        -- result为nil或其他值，表示录音启动失败
        log.error("handler_call.recordCallback", "录音启动失败，可能是格式或参数问题", "result:", result, "size:", size)
        -- 录音失败也要清理录音文件
        cleanupRecordFile()
        -- 尝试重新启动录音，使用更简单的参数
        sys.timerStart(function()
            log.info("handler_call.recordCallback", "尝试重新启动录音，使用更简单参数")
            -- 使用更简单的参数重试，指定WAV格式和通话通道
            local ret = record.start(30, function(r, s)
                log.info("handler_call.recordCallback", "重试录音结束", "result:", r, "size:", s)
                if r then
                    upload()
                else
                    recordUploadResultNotify(false, nil, "录音失败")
                    -- 重试失败也要清理录音文件
                    cleanupRecordFile()
                end
            end, "FILE", 2, 1, 2)  -- 30秒，回调，文件存储，高质量，通话通道，WAV格式
            log.info("handler_call.recordCallback", "重试录音返回:", ret)
        end, 1000) -- 1秒后重试
        return
    end
    
    -- 如果通话仍在进行中，设置定时器在通话结束后更新通知
    if cc.anyCallExist() then
        log.info("handler_call.recordCallback", "通话仍在进行中，等待通话自然结束")
        sys.timerStart(function()
            if not cc.anyCallExist() then
                log.info("handler_call.recordCallback", "通话已结束")
                -- 更新通知，确保显示正确的通话时长
                recordUploadResultNotify(result, nil, "录音完成")
            end
        end, 1000) -- 1秒后检查通话状态
    end
end

-- 开始录音
local function recordStart()
    if not record_enable then
        log.info("handler_call.recordStart", "未开启录音")
        return
    end

    if cc.anyCallExist() then
        log.info("handler_call.recordStart", "正在通话中, 开始录音")
        log.info("handler_call.recordStart", "录音配置", "格式:", record_format, "质量:", record_quality, "最大时长:", record_max_time)
        CALL_RECORD_START_TIME = rtos.tick() * 5
        
        -- 使用amrnb格式录音，已在全局配置中设置
        log.info("handler_call.recordStart", "使用amrnb格式录音，格式:", record_format, "质量:", record_quality)
        
        -- 确保音频通道正确设置为通话通道
        audio.setChannel(AUDIO_OUTPUT_CHANNEL_NORMAL, AUDIO_INPUT_CHANNEL_NORMAL)
        log.info("handler_call.recordStart", "已设置音频通道为通话通道")
        
        -- record.start(最大录音时间, 录音结束回调, 存储类型, 录音质量, 录音类型, 录音格式)
        -- 参数说明：
        -- 录音类型(rcdType): 1=mic, 2=voice(通话), 3=voice_dual
        -- 录音格式(format): 1=pcm, 2=wav, 3=amrnb, 4=speex
        log.info("handler_call.recordStart", "使用voice通道(2)和amrnb格式(3)录音")
        local ret, msg = record.start(record_max_time, recordCallback, "FILE", record_quality, 2, record_format)
        log.info("handler_call.recordStart", "record.start返回值:", ret, msg)
    else
        log.info("handler_call.recordStart", "通话已结束, 不录音")
        recordUploadResultNotify(false, nil, "呼叫方提前挂断电话, 无录音")
    end
end

------------------------------------------------- TTS 相关 --------------------------------------------------

-- TTS 播放结束回调
local function ttsCallback(result)
    log.info("handler_call.ttsCallback", "result:", result)

    -- 无论什么来电动作，都启动录音
    log.info("handler_call.ttsCallback", "启动录音")
    -- 增加延时，确保音频配置完全生效
    sys.timerStart(recordStart, 500)
end

-- 播放 TTS, 播放结束后开始录音
local function tts()
    log.info("handler_call.tts", "TTS 播放开始")

    -- 无论什么来电动作，都要启动录音
    -- 检查是否需要播放TTS
    local tts_text = nvm.get("TTS_TEXT") or ""
    if tts_text ~= "" then
        -- 播放 TTS
        log.info("handler_call.callConnected", "播放自定义TTS:", tts_text, "来电动作:", getCallInAction())
        audio.setTTSSpeed(60)
        audio.play(7, "TTS", tts_text, 7, ttsCallback)
    else
        -- 播放音频文件
        if getCallInAction() == 3 then
            util_audio.audioStream("/lua/audio_pickup_hangup.amr", ttsCallback)
        else
            util_audio.audioStream("/lua/audio_pickup_record.amr", ttsCallback)
        end
    end
end

------------------------------------------------- 电话回调函数 --------------------------------------------------

-- 电话拨入回调
-- 设备主叫时, 不会触发此回调
local function callIncomingCallback(num)
    -- 来电号码
    CALL_NUMBER = num or "unknown"

    -- 来电动作, 挂断
    if getCallInAction() == 2 then
        log.info("handler_call.callIncomingCallback", "来电动作", "挂断")
        cc.hangUp(num)
        -- 发通知
        util_notify.add({ "来电号码: " .. num, "来电动作: 挂断", "", "#CALL #CALL_IN" })
        return
    end

    -- CALL_IN 从电话接入到挂断都是 true, 用于判断是否为来电中, 本函数会被多次触发
    if CALL_IN then
        return
    end

    -- 更新音频配置
    updateAudioConfig(false)

    -- 来电动作, 无操作 or 接听
    if getCallInAction() == 0 then
        log.info("handler_call.callIncomingCallback", "来电动作", "无操作")
    else
        log.info("handler_call.callIncomingCallback", "来电动作", "接听")
        -- 标记接听来电中
        CALL_IN = true
        -- 延迟接听电话
        local delay = getCallInAction() == 4 and (1000 * 30) or (1000 * 3)
        sys.timerStart(cc.accept, delay, num)
    end

    -- 发送除了 来电动作为挂断 之外的通知
    local action_desc = { [0] = "无操作", [1] = "自动接听", [2] = "挂断", [3] = "自动接听后挂断", [4] = "等待30秒后自动接听" }
    util_notify.add({ "来电号码: " .. num, "来电动作: " .. action_desc[getCallInAction()], "", "#CALL #CALL_IN" })
end

-- 电话接通回调
local function callConnectedCallback(num)
    -- 再次标记接听来电中, 防止设备主叫时, 不触发 `CALL_INCOMING` 回调, 导致 CALL_IN 为 false
    CALL_IN = true
    -- 接通时间
    CALL_CONNECTED_TIME = rtos.tick() * 5
    -- 来电号码
    CALL_NUMBER = num or "unknown"

    CALL_DISCONNECTED_TIME = 0
    CALL_RECORD_START_TIME = 0

    log.info("handler_call.callConnectedCallback", num)

    -- 更新音频配置
    updateAudioConfig(true)

    -- 停止之前的播放
    audio.stop()

    -- 向对方播放留言提醒 TTS（可选）
    sys.timerStart(tts, 1000 * 1)

    -- 最大通话时间后, 结束通话
    sys.timerStart(cc.hangUp, call_max_time * 1000, num)
end

-- 电话挂断回调
-- 设备主叫时, 被叫方主动挂断电话或者未接, 也会触发此回调
local function callDisconnectedCallback(discReason)
    -- 标记来电结束
    CALL_IN = false
    -- 通话结束时间
    CALL_DISCONNECTED_TIME = rtos.tick() * 5
    -- 清除所有挂断通话定时器, 防止多次触发挂断回调
    sys.timerStopAll(cc.hangUp)

    log.info("handler_call.callDisconnectedCallback", "挂断原因:", discReason)

    -- 录音结束
    record.stop()
    -- TTS 结束
    -- tts(util_audio.audioStream 播放的音频文件) 在播放中通话被挂断, 然后在 callDisconnectedCallback 中调用 audio.stop() 有时不会触发 ttsCallback 回调
    -- 调用 audiocore.stop() 可以解决这个问题
    audio.stop(function(result)
        log.info("handler_call.callDisconnectedCallback", "audio.stop() callback result:", result)
    end)
    audiocore.stop()

    -- 更新音频配置
    updateAudioConfig(false)
end

-- 注册电话回调
sys.subscribe("CALL_INCOMING", callIncomingCallback)
sys.subscribe("CALL_CONNECTED", callConnectedCallback)
sys.subscribe("CALL_DISCONNECTED", callDisconnectedCallback)

ril.regUrc("RING", function()
    -- 来电铃声
    local vol = nvm.get("AUDIO_VOLUME") or 0
    if vol == 0 then
        return
    end
    audio.play(4, "FILE", "/lua/audio_ring.mp3", vol)
end)

-- 来电中保持 LTE 灯闪烁
sys.taskInit(function()
    while true do
        if CALL_IN or cc.anyCallExist() then
            sys.publish("LTE_LED_UPDATE", false)
            sys.wait(100)
            sys.publish("LTE_LED_UPDATE", true)
            sys.wait(100)
        else
            sys.waitUntil("RING", 1000 * 5)
        end
    end
end)
