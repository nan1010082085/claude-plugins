---
description: 用视觉模型识别图片（vision-relay）
---
用户请求：$ARGUMENTS

执行规则：
1. 你无法查看图片。涉及图片路径或 URL 时，必须先调用 vision_describe 工具获取描述，严禁猜测。
2. 传图方式：
   a. 图片路径 → vision_describe(path="./xxx.png")
   b. 图片 URL → vision_describe(url="https://...")
   c. 用户粘贴的图片（消息里的 [Image #N]）-> 通常 hook 已自动注入识别结果（[vision-relay 图片 #N]），直接用即可，无需再调用工具；未注入时提示用户提供图片路径或 URL
3. 把用户的疑问作为 vision_describe 的 question 参数传入，让识别围绕问题展开。
4. 拿到描述后回答；描述不足则换更具体的 question 再调一次。
5. 没有图片路径或 URL 时提醒用户提供：/vision ./error.png 这个报错怎么修
6. 提示"配置不完整"时，运行 /vision-config 配置视觉模型。
