// ============================================================
// 认证服务 — 邮件发送服务
// 支持 SMTP（生产环境）和控制台（开发/测试）两种传输方式
// ============================================================

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

// ---- 配置 ----

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
}

function getEmailConfig(): EmailConfig {
  return {
    host: process.env.SMTP_HOST || "localhost",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    },
    from: process.env.SMTP_FROM || "QuickDrop <noreply@quickdrop.app>",
  };
}

// ---- 传输器 ----

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  // 开发/测试环境：使用控制台输出而非实际发送邮件
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    transporter = nodemailer.createTransport({
      streamTransport: true,
      newline: "unix",
      buffer: true,
    });
  } else {
    const config = getEmailConfig();
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
  }

  return transporter;
}

// ---- 重置 transporter（测试用）----

export function resetEmailTransporter(): void {
  transporter = null;
}

// ---- 邮件发送 ----

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const transport = getTransporter();
  const config = getEmailConfig();

  await transport.sendMail({
    from: config.from,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });
}

// ---- 密码重置邮件 ----

/**
 * 生成密码重置邮件的 HTML 内容
 */
function buildResetPasswordEmail(resetLink: string): string {
  const appName = "QuickDrop";
  const expiryMinutes = 15;

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #333; }
    .container { max-width: 480px; margin: 0 auto; padding: 24px; }
    .header { font-size: 20px; font-weight: 700; margin-bottom: 16px; color: #1a1a2e; }
    .btn { display: inline-block; padding: 12px 24px; background: #4f46e5; color: #fff !important;
           text-decoration: none; border-radius: 8px; font-weight: 600; margin: 16px 0; }
    .link { color: #6b7280; font-size: 12px; word-break: break-all; margin-top: 8px; }
    .footer { color: #9ca3af; font-size: 12px; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">🔐 重置你的 ${appName} 密码</div>
    <p>我们收到了你的密码重置请求。点击下方按钮重置密码：</p>
    <a class="btn" href="${resetLink}">重置密码</a>
    <p style="font-size: 14px; color: #6b7280;">
      此链接将在 ${expiryMinutes} 分钟后过期。<br>
      如果你没有请求重置密码，请忽略此邮件。
    </p>
    <p class="link">如果按钮无法点击，请复制以下链接到浏览器：<br>${resetLink}</p>
    <div class="footer">
      ${appName} 团队<br>
      此邮件由系统自动发送，请勿回复。
    </div>
  </div>
</body>
</html>`.trim();
}

/**
 * 发送密码重置邮件
 */
export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<void> {
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:5173";
  const resetLink = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

  await sendEmail({
    to,
    subject: "QuickDrop — 重置你的密码",
    html: buildResetPasswordEmail(resetLink),
  });
}
