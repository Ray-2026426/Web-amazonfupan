import { FilterSnapshot, FilterState } from '../types';

const STORAGE_KEY = 'amazon_dashboard_filter_snapshots';
const MAX_SNAPSHOTS = 6;

/** 读取所有已保存的快照 */
export const loadSnapshots = (): FilterSnapshot[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as FilterSnapshot[];
  } catch {
    return [];
  }
};

/** 保存所有快照到 localStorage */
const persistSnapshots = (snapshots: FilterSnapshot[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // localStorage 满了或不可用，静默失败
  }
};

/** 保存一个新快照。超过上限时自动替换最老的 */
export const saveSnapshot = (
  name: string,
  filters: FilterState,
  isWeeklyMode: boolean
): FilterSnapshot[] => {
  const snapshots = loadSnapshots();
  
  // 同名覆盖
  const existingIdx = snapshots.findIndex(s => s.name === name);
  const snapshot: FilterSnapshot = {
    id: existingIdx >= 0 ? snapshots[existingIdx].id : `snap_${Date.now()}`,
    name,
    filters: JSON.parse(JSON.stringify(filters)), // 深拷贝
    isWeeklyMode,
    createdAt: Date.now(),
  };

  if (existingIdx >= 0) {
    snapshots[existingIdx] = snapshot;
  } else {
    // 超出上限，删最老的
    if (snapshots.length >= MAX_SNAPSHOTS) {
      snapshots.sort((a, b) => a.createdAt - b.createdAt);
      snapshots.shift();
    }
    snapshots.push(snapshot);
  }

  // 按创建时间倒序排列
  snapshots.sort((a, b) => b.createdAt - a.createdAt);
  persistSnapshots(snapshots);
  return snapshots;
};

/** 删除指定快照 */
export const deleteSnapshot = (id: string): FilterSnapshot[] => {
  const snapshots = loadSnapshots().filter(s => s.id !== id);
  persistSnapshots(snapshots);
  return snapshots;
};

/** 重命名快照 */
export const renameSnapshot = (id: string, newName: string): FilterSnapshot[] => {
  const snapshots = loadSnapshots();
  const target = snapshots.find(s => s.id === id);
  if (target) {
    target.name = newName;
    persistSnapshots(snapshots);
  }
  return snapshots;
};
