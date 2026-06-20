import Foundation
import Security

/// Token 安全存储管理器
///
/// 使用 iOS Keychain 进行加密存储。
/// Keychain 数据由 Secure Enclave / 系统级加密保护。
///
/// 存储内容：
/// - Access Token (JWT, 短期有效)
/// - Refresh Token (JWT, 30 天有效)
///
/// 对应 Android 的 TokenManager (EncryptedSharedPreferences)
final class TokenManager {
    static let shared = TokenManager()

    private init() {}

    // MARK: - Keychain Keys

    private let serviceName = "com.quickdrop.app"
    private let accessTokenKey = "qd_access_token"
    private let refreshTokenKey = "qd_refresh_token"

    // MARK: - Public API

    /// 保存 Token 对
    func saveTokens(accessToken: String, refreshToken: String) {
        save(key: accessTokenKey, value: accessToken)
        save(key: refreshTokenKey, value: refreshToken)
    }

    /// 获取 Access Token（检查是否过期）
    func getAccessToken() -> String? {
        guard let token = read(key: accessTokenKey) else { return nil }
        return isTokenExpired(token) ? nil : token
    }

    /// 获取 Access Token（不检查过期）
    func getAccessTokenRaw() -> String? {
        return read(key: accessTokenKey)
    }

    /// 获取 Refresh Token（检查是否过期）
    func getRefreshToken() -> String? {
        guard let token = read(key: refreshTokenKey) else { return nil }
        if isTokenExpired(token) {
            clearTokens()
            return nil
        }
        return token
    }

    /// 清除所有 Token
    func clearTokens() {
        delete(key: accessTokenKey)
        delete(key: refreshTokenKey)
    }

    // MARK: - Private: Keychain Operations

    private func save(key: String, value: String) {
        // 先删除旧值
        delete(key: key)

        guard let data = value.data(using: .utf8) else { return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        SecItemAdd(query as CFDictionary, nil)
    }

    private func read(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let string = String(data: data, encoding: .utf8) else {
            return nil
        }

        return string
    }

    private func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - Private: JWT 解析

    /// 解析 JWT 的 exp 字段（不验证签名，仅检查过期）
    /// JWT 格式: header.payload.signature
    private func isTokenExpired(_ token: String) -> Bool {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return true }

        let payload = String(parts[1])
        guard let decoded = base64URLDecode(payload),
              let json = try? JSONSerialization.jsonObject(with: decoded) as? [String: Any],
              let exp = json["exp"] as? TimeInterval else {
            // 无 exp 字段视为永不过期
            return false
        }

        let now = Date().timeIntervalSince1970
        return now >= exp
    }

    /// Base64URL 解码（无填充版本）
    private func base64URLDecode(_ string: String) -> Data? {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        // 补齐填充
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }

        return Data(base64Encoded: base64)
    }
}
