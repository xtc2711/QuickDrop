// ============================================================
// 认证服务 — Admin 业务逻辑
// 用户管理、设备管理、统计查询
// ============================================================

import { PrismaClient } from "@prisma/client";
import { AppError } from "../utils/AppError.js";

const prisma = new PrismaClient();

export interface UserListItem {
  id: string;
  email: string;
  is_locked: boolean;
  is_admin: boolean;
  failed_login_attempts: number;
  device_count: number;
  online_device_count: number;
  created_at: string;
  last_active: string | null;
}

export interface UserDetail extends UserListItem {
  updated_at: string;
  locked_until: string | null;
  devices: Array<{
    id: string;
    device_name: string;
    device_type: string;
    os: string;
    is_online: boolean;
    first_seen: string;
    last_seen: string;
  }>;
}

export interface DeviceListItem {
  id: string;
  device_name: string;
  device_type: string;
  os: string;
  is_online: boolean;
  user_email: string;
  user_id: string;
  first_seen: string;
  last_seen: string;
}

export interface DashboardStats {
  total_users: number;
  total_devices: number;
  online_devices: number;
  locked_users: number;
  users_registered_today: number;
  users_registered_this_week: number;
  active_users_24h: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export class AdminService {
  /**
   * 获取管理后台仪表盘统计
   */
  async getDashboardStats(): Promise<DashboardStats> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalDevices,
      onlineDevices,
      lockedUsers,
      usersToday,
      usersThisWeek,
      activeUsers24h,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.device.count(),
      prisma.device.count({ where: { isOnline: true } }),
      prisma.user.count({ where: { isLocked: true } }),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.user.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.device.groupBy({
        by: ["userId"],
        where: { lastSeen: { gte: dayAgo } },
      }).then((groups) => groups.length),
    ]);

    return {
      total_users: totalUsers,
      total_devices: totalDevices,
      online_devices: onlineDevices,
      locked_users: lockedUsers,
      users_registered_today: usersToday,
      users_registered_this_week: usersThisWeek,
      active_users_24h: activeUsers24h,
    };
  }

  /**
   * 获取用户列表（分页 + 搜索）
   */
  async listUsers(
    page: number = 1,
    pageSize: number = 20,
    search?: string,
    filters?: { is_locked?: boolean; is_admin?: boolean },
  ): Promise<PaginatedResult<UserListItem>> {
    const where: any = {};

    if (search) {
      where.email = { contains: search, mode: "insensitive" };
    }
    if (filters?.is_locked !== undefined) {
      where.isLocked = filters.is_locked;
    }
    if (filters?.is_admin !== undefined) {
      where.isAdmin = filters.is_admin;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          devices: {
            select: { id: true, isOnline: true, lastSeen: true },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const items: UserListItem[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      is_locked: u.isLocked,
      is_admin: u.isAdmin,
      failed_login_attempts: u.failedLoginAttempts,
      device_count: u.devices.length,
      online_device_count: u.devices.filter((d) => d.isOnline).length,
      created_at: u.createdAt.toISOString(),
      last_active:
        u.devices.length > 0
          ? u.devices
              .map((d) => d.lastSeen)
              .sort()
              .reverse()[0]
              ?.toISOString() ?? null
          : null,
    }));

    return {
      items,
      total,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取用户详情
   */
  async getUserDetail(userId: string): Promise<UserDetail> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        devices: {
          orderBy: { lastSeen: "desc" },
        },
      },
    });

    if (!user) {
      throw new AppError(404, "用户不存在");
    }

    return {
      id: user.id,
      email: user.email,
      is_locked: user.isLocked,
      is_admin: user.isAdmin,
      failed_login_attempts: user.failedLoginAttempts,
      device_count: user.devices.length,
      online_device_count: user.devices.filter((d) => d.isOnline).length,
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
      locked_until: user.lockedUntil?.toISOString() ?? null,
      last_active:
        user.devices.length > 0
          ? user.devices
              .map((d) => d.lastSeen)
              .sort()
              .reverse()[0]
              ?.toISOString() ?? null
          : null,
      devices: user.devices.map((d) => ({
        id: d.id,
        device_name: d.deviceName,
        device_type: d.deviceType,
        os: d.os,
        is_online: d.isOnline,
        first_seen: d.firstSeen.toISOString(),
        last_seen: d.lastSeen.toISOString(),
      })),
    };
  }

  /**
   * 锁定 / 解锁用户
   */
  async toggleUserLock(userId: string): Promise<{ is_locked: boolean }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, "用户不存在");

    if (user.isLocked) {
      // 解锁
      await prisma.user.update({
        where: { id: userId },
        data: {
          isLocked: false,
          lockedUntil: null,
          failedLoginAttempts: 0,
        },
      });
      return { is_locked: false };
    } else {
      // 锁定（24 小时）
      await prisma.user.update({
        where: { id: userId },
        data: {
          isLocked: true,
          lockedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      return { is_locked: true };
    }
  }

  /**
   * 删除用户
   */
  async deleteUser(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, "用户不存在");

    if (user.isAdmin) {
      throw new AppError(400, "不能删除管理员账户");
    }

    // 级联删除：devices, refresh_tokens, password_reset_tokens
    await prisma.user.delete({ where: { id: userId } });
  }

  /**
   * 切换用户管理员状态
   */
  async toggleAdmin(userId: string): Promise<{ is_admin: boolean }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(404, "用户不存在");

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { isAdmin: !user.isAdmin },
    });

    return { is_admin: updated.isAdmin };
  }

  /**
   * 获取所有设备列表（分页）
   */
  async listDevices(
    page: number = 1,
    pageSize: number = 20,
    search?: string,
    filters?: { is_online?: boolean },
  ): Promise<PaginatedResult<DeviceListItem>> {
    const where: any = {};

    if (search) {
      where.deviceName = { contains: search, mode: "insensitive" };
    }
    if (filters?.is_online !== undefined) {
      where.isOnline = filters.is_online;
    }

    const [devices, total] = await Promise.all([
      prisma.device.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { lastSeen: "desc" },
        include: {
          user: { select: { email: true } },
        },
      }),
      prisma.device.count({ where }),
    ]);

    const items: DeviceListItem[] = devices.map((d) => ({
      id: d.id,
      device_name: d.deviceName,
      device_type: d.deviceType,
      os: d.os,
      is_online: d.isOnline,
      user_email: d.user.email,
      user_id: d.userId,
      first_seen: d.firstSeen.toISOString(),
      last_seen: d.lastSeen.toISOString(),
    }));

    return {
      items,
      total,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 强制移除设备
   */
  async forceRemoveDevice(deviceId: string): Promise<void> {
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new AppError(404, "设备不存在");

    // 撤销该设备的所有 Refresh Token
    await prisma.refreshToken.updateMany({
      where: { deviceId, revoked: false },
      data: { revoked: true },
    });

    await prisma.device.update({
      where: { id: deviceId },
      data: { isOnline: false, isActive: false },
    });
  }
}
