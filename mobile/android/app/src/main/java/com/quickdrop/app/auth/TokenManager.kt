package com.quickdrop.app.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Token 安全存储管理器
 *
 * 使用 AndroidX EncryptedSharedPreferences 进行 AES-256 加密存储
 * 密钥由 Android Keystore 硬件保护（TEE 或 StrongBox）
 *
 * 存储内容：
 * - Access Token (JWT, 15 分钟过期)
 * - Refresh Token (JWT, 30 天过期)
 */
class TokenManager(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "quickdrop_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    /**
     * 保存 Token 对
     */
    fun saveTokens(accessToken: String, refreshToken: String) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_REFRESH_TOKEN, refreshToken)
            .apply()
    }

    /**
     * 获取 Access Token
     */
    fun getAccessToken(): String? {
        val token = prefs.getString(KEY_ACCESS_TOKEN, null) ?: return null

        // 检查是否过期（简单 JWT exp 解析，不验证签名）
        if (isTokenExpired(token)) {
            return null
        }
        return token
    }

    /**
     * 获取 Access Token（不检查过期，供刷新 Token 后更新用）
     */
    fun getAccessTokenRaw(): String? {
        return prefs.getString(KEY_ACCESS_TOKEN, null)
    }

    /**
     * 获取 Refresh Token
     */
    fun getRefreshToken(): String? {
        val token = prefs.getString(KEY_REFRESH_TOKEN, null) ?: return null
        if (isTokenExpired(token)) {
            clearTokens()
            return null
        }
        return token
    }

    /**
     * 清除所有 Token
     */
    fun clearTokens() {
        prefs.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .apply()
    }

    // ============================================================
    // Private
    // ============================================================

    /**
     * 解析 JWT 的 exp 字段（不验证签名）
     * 格式: header.payload.signature
     */
    private fun isTokenExpired(token: String): Boolean {
        return try {
            val parts = token.split(".")
            if (parts.size != 3) return true

            val payload = String(android.util.Base64.decode(parts[1], android.util.Base64.URL_SAFE))
            val exp = org.json.JSONObject(payload).optLong("exp", 0)
            if (exp == 0L) return false // 无 exp 字段则不过期

            val now = System.currentTimeMillis() / 1000
            now >= exp
        } catch (e: Exception) {
            // 解析失败视为无效
            true
        }
    }

    companion object {
        private const val KEY_ACCESS_TOKEN = "qd_access_token"
        private const val KEY_REFRESH_TOKEN = "qd_refresh_token"
    }
}
