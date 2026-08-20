---
description: 用视觉模型识别图片（vision-relay）
---
用户请求：$ARGUMENTS

执行规则：
1. 你可能无法直接查看图片。回答中凡是涉及图片路径或 URL 的内容，必须先调用 vision_describe 工具获取描述，严禁凭文件名或上下文猜测图片内容。
2. 如果参数中带具体问题，把问题作为 vision_describe 的 question 参数传入，让识别围绕问题展开。
3. 拿到描述后结合描述回答；若描述不足以回答，换一个更具体的 question 再调用一次。
4. 如果参数中没有图片路径或 URL，提醒用户提供，例如：/vision ./screenshots/error.png 这个报错怎么修
