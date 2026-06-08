import crypto from 'crypto'
import * as https from 'https'

export function verifyLineSignature(body: string, signature: string, channelSecret: string): boolean {
  const hash = crypto.createHmac('SHA256', channelSecret).update(body).digest('base64')
  return hash === signature
}

export async function replyMessage(replyToken: string, messages: LineMessage[]): Promise<void> {
  const body = JSON.stringify({ replyToken, messages })
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body,
  })
}

export async function getLineImageContent(messageId: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
  })
  const arrayBuffer = await response.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  const mimeType = response.headers.get('content-type') || 'image/jpeg'
  return { base64, mimeType }
}

export async function getLineFileContent(messageId: string): Promise<string> {
  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
  })
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer).toString('utf-8')
}

export interface LineMessage {
  type: string
  text?: string
}

export interface LineTextMessage extends LineMessage {
  type: 'text'
  text: string
}

export function textMessage(text: string): LineTextMessage {
  return { type: 'text', text }
}

export async function pushMessage(userId: string, messages: LineMessage[]): Promise<void> {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to: userId, messages }),
  })
}
