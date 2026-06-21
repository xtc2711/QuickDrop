-- 添加 is_admin 字段到 users 表
-- 用于管理后台权限控制，默认 false
ALTER TABLE "users" ADD COLUMN "is_admin" BOOLEAN NOT NULL DEFAULT false;
