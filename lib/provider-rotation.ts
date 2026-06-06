// Provider 自动轮换的共享常量。
// 故意不 import 任何服务端模块,这样 client(workspace 下拉)和 server(provider.ts)都能安全引用。
//
// 语义:presetId === ROTATE_PRESET_ID 时,后端按轮询在所有 Provider(preset)间取一个,
// 选中的失败则顺延下一个(failover)。普通的具体 presetId 走原来的"单 preset + 内部 key 轮换"。

export const ROTATE_PRESET_ID = "__rotate__";

export function isRotatePreset(id: string | null | undefined): boolean {
  return id === ROTATE_PRESET_ID;
}
