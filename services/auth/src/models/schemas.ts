// ============================================================
// 认证服务 — Zod 校验 Schema
// ============================================================

import { z } from "zod";
import { validateEmail, validatePasswordStrength } from "../../../../shared/utils/index.js";

export const registerSchema = z
  .object({
    email: z
      .string()
      .max(255, "邮箱不能超过 255 个字符")
      .refine((v) => validateEmail(v), "邮箱格式不正确"),
    password: z
      .string()
      .min(8, "密码至少 8 位")
      .max(128, "密码不能超过 128 位"),
    device_name: z.string().min(1, "设备名称不能为空").max(128),
    device_type: z.enum(["desktop", "phone", "tablet"]),
    os: z.enum(["windows", "macos", "android", "ios"]),
  })
  .refine(
    (data) => {
      const result = validatePasswordStrength(data.password);
      return result.valid;
    },
    { message: "密码必须包含大写字母、小写字母和数字", path: ["password"] },
  );

export const loginSchema = z.object({
  email: z.string().max(255).refine((v) => validateEmail(v), "邮箱格式不正确"),
  password: z.string().min(1, "密码不能为空"),
  device_name: z.string().min(1, "设备名称不能为空").max(128),
  device_type: z.enum(["desktop", "phone", "tablet"]),
  os: z.enum(["windows", "macos", "android", "ios"]),
  remember_device: z.boolean().optional().default(false),
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(1, "Refresh Token 不能为空"),
});

export const logoutSchema = z.object({
  all_devices: z.boolean().optional().default(false),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
