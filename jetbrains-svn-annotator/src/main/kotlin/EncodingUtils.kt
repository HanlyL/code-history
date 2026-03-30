package com.svnannotator

import java.nio.charset.Charset

/**
 * 编码工具类，用于处理 SVN 命令输出的编码问题
 * 
 * SVN 命令输出可能使用不同编码：
 * - XML 输出通常为 UTF-8
 * - Windows 系统上的错误信息可能使用 GBK 编码
 * - 某些提交信息可能包含中文字符
 */
object EncodingUtils {
    /**
     * 替换字符，表示解码失败
     */
    private const val REPLACEMENT_CHAR = '�'
    
    /**
     * 支持的编码列表，按优先级排序
     */
    private val SUPPORTED_ENCODINGS = listOf(
        Charsets.UTF_8,
        Charset.forName("GBK"),
        Charset.forName("GB18030")
    )
    
    /**
     * 解码 SVN 命令输出的字节数组
     * 
     * 解码策略：
     * 1. 首先尝试 UTF-8 解码
     * 2. 如果结果包含替换字符（乱码标记），尝试 GBK 解码
     * 3. 如果 GBK 解码失败，回退到 UTF-8 结果
     * 
     * @param bytes SVN 命令输出的原始字节
     * @return 正确解码的字符串
     */
    fun decodeSvnOutput(bytes: ByteArray): String {
        if (bytes.isEmpty()) return ""
        
        // 首先尝试 UTF-8
        val utf8Result = tryDecode(bytes, Charsets.UTF_8)
        
        // 检查是否有乱码标记
        if (!containsReplacementChar(utf8Result)) {
            return utf8Result
        }
        
        // 尝试其他编码
        for (charset in SUPPORTED_ENCODINGS.drop(1)) {
            val result = tryDecode(bytes, charset)
            if (!containsReplacementChar(result)) {
                return result
            }
        }
        
        // 所有编码都失败，返回 UTF-8 结果
        return utf8Result
    }
    
    /**
     * 尝试使用指定编码解码字节数组
     */
    private fun tryDecode(bytes: ByteArray, charset: Charset): String {
        return try {
            bytes.toString(charset)
        } catch (e: Exception) {
            ""
        }
    }
    
    /**
     * 检查字符串是否包含替换字符（解码失败的标志）
     */
    private fun containsReplacementChar(str: String): Boolean {
        return str.contains(REPLACEMENT_CHAR)
    }
}
