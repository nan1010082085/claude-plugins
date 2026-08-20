---
description: 用视觉模型识别图片（vision-relay）
---
用户请求：$ARGUMENTS

执行规则：
1. 你无法查看图片。涉及图片路径或 URL 时，必须先调用 vision_describe 工具获取描述，严禁猜测。
2. 把用户的疑问作为 vision_describe 的 question 参数传入，让识别围绕问题展开。
3. 拿到描述后回答；描述不足则换更具体的 question 再调一次。
4. 没有图片路径或 URL 时提醒用户提供：/vision ./error.png 这个报错怎么修
5. 提示"配置不完整"时，运行 /vision-config 配置视觉模型。
