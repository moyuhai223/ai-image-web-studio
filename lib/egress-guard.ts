import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * 出站 SSRF 守卫:出站请求前校验 baseUrl 的主机不解析到内网/环回/链路本地/云元数据地址。
 * 用于 provider 生成、提示词优化、preset 连通性探测等所有把上游 baseUrl 拼进 fetch 的地方——
 * 避免「让服务器代持真实上游 Key 打任意内部目标」(读云元数据、探内网端口、Key 外泄)。
 * 只做协议 + 解析后 IP 分类;不改重定向行为(跟随重定向到内网属残余风险,直接指定内网的主路径已封)。
 */

const PROTOCOLS = new Set(["http:", "https:"]);

export class EgressBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressBlockedError";
  }
}

/** 判断一个 IP 字面量是否属于不允许出站的网段(内网/环回/链路本地/CGNAT/保留)。 */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (net.isIPv6(ip)) {
    const bytes = ipv6ToBytes(ip);
    if (!bytes) return true; // 解析失败 → 保守拒绝
    return isBlockedIpv6(bytes);
  }
  return true; // 无法识别 → 保守拒绝
}

function isBlockedIpv4(ip: string): boolean {
  const p = ip.split(".").map((n) => Number(n));
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true; // "本网络"
  if (a === 10) return true; // 私网
  if (a === 127) return true; // 环回
  if (a === 169 && b === 254) return true; // 链路本地(含 169.254.169.254 云元数据)
  if (a === 172 && b >= 16 && b <= 31) return true; // 私网
  if (a === 192 && b === 168) return true; // 私网
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10(阿里云元数据 100.100.x 落此段)
  if (a >= 224) return true; // 组播/保留
  return false;
}

/**
 * IPv6 判定。关键:任何「IPv4-in-IPv6」编码(new URL 会把 ::ffff:127.0.0.1 归一化成 hex 段 ::ffff:7f00:1)
 * 都必须提取内嵌 IPv4 再按 v4 规则判,否则会漏掉环回/元数据。故先展开成 16 字节,再统一识别。
 */
function isBlockedIpv6(b: number[]): boolean {
  const dotted = () => `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
  if (b.every((x) => x === 0)) return true; // :: 未指定
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true; // ::1 环回
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 链路本地
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 唯一本地地址(fc/fd)
  // IPv4-mapped ::ffff:0:0/96
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) return isBlockedIpv4(dotted());
  // NAT64 64:ff9b::/96
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
    return isBlockedIpv4(dotted());
  }
  // IPv4-compatible ::/96(已废弃但仍可解析,如 ::7f00:1 = ::127.0.0.1)
  if (b.slice(0, 12).every((x) => x === 0)) return isBlockedIpv4(dotted());
  return false;
}

/** 把已通过 net.isIPv6 校验的 IPv6 字面量展开成 16 字节;含内嵌点分 IPv4、:: 压缩、zone id。失败返回 null。 */
function ipv6ToBytes(addr: string): number[] | null {
  let s = addr.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);

  const expand = (groups: string[]): string[] | null => {
    const out: string[] = [];
    for (const g of groups) {
      if (g.includes(".")) {
        const q = g.split(".").map((n) => Number(n));
        if (q.length !== 4 || q.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        out.push(((q[0] << 8) | q[1]).toString(16), ((q[2] << 8) | q[3]).toString(16));
      } else {
        out.push(g);
      }
    }
    return out;
  };

  let full: string[];
  if (s.includes("::")) {
    const parts = s.split("::");
    if (parts.length > 2) return null;
    const head = expand(parts[0] ? parts[0].split(":") : []);
    const tail = expand(parts[1] ? parts[1].split(":") : []);
    if (!head || !tail) return null;
    const missing = 8 - (head.length + tail.length);
    if (missing < 0) return null;
    full = [...head, ...Array(missing).fill("0"), ...tail];
  } else {
    const groups = expand(s.split(":"));
    if (!groups) return null;
    full = groups;
  }
  if (full.length !== 8) return null;

  const bytes: number[] = [];
  for (const grp of full) {
    const v = parseInt(grp || "0", 16);
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null;
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

/**
 * 校验 baseUrl 可安全出站:协议为 http/https,且主机名解析到的所有 IP 均非内网。
 * 命中内网/无法解析即抛 EgressBlockedError。DNS 解析结果与实际连接存在 TOCTOU(DNS rebinding)——
 * 对本站「baseUrl 由 admin 持久配置」的威胁模型足够;更强需自定义 agent 逐跳复核,暂不引入。
 */
export async function assertPublicBaseUrl(baseUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new EgressBlockedError("出站地址不是有效 URL");
  }
  if (!PROTOCOLS.has(url.protocol)) {
    throw new EgressBlockedError("出站地址仅允许 http/https");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new EgressBlockedError("出站目标为内网/保留地址,已拒绝");
    return;
  }

  let records: Array<{ address: string }>;
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new EgressBlockedError("出站目标域名无法解析,已拒绝");
  }
  if (records.length === 0) {
    throw new EgressBlockedError("出站目标域名无解析结果,已拒绝");
  }
  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new EgressBlockedError("出站目标解析到内网/保留地址,已拒绝");
    }
  }
}
