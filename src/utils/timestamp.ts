
export function getTimestamp() {
    return process.env.TIMEZONE
        // sv-SE 可以完美输出类似于 ISO 的 YYYY-MM-DD HH:mm:ss 格式
        ? new Intl.DateTimeFormat("sv-SE", { 
            timeZone: process.env.TIMEZONE,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
        // 把中间的空格换成 T，向 ISO 看齐
        }).format(new Date()).replace(" ", "T") 
        : new Date().toISOString();
}