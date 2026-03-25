package com.svnannotator

data class SvnAnnotation(
    val lineNumber: Int,
    val author: String,
    val date: String,
    val message: String,
    val revision: String
)

data class LoginResult(
    val success: Boolean,
    val error: String? = null
)

data class CacheEntry(
    val annotations: List<SvnAnnotation>,
    val timestamp: Long,
    val fileModifiedTime: Long
)