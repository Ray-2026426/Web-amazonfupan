
import { DataRow, InventoryRow, RefundRow, ReviewRow, TargetRow, FilterState } from './types';

// We use native IndexedDB API directly to avoid external dependency issues in some environments.
// Removed 'idb' import as we are implementing the wrapper manually below.

const DB_NAME = 'AmazonDashboardDB';
const DB_VERSION = 5;

const openDatabase = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        // Ensure we are in a browser environment
        if (!window.indexedDB) {
            reject("IndexedDB not supported");
            return;
        }

        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error("Database error: ", event);
            reject("Database error");
        };

        request.onsuccess = (event) => {
            resolve((event.target as IDBOpenDBRequest).result);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            const stores = ['monthly', 'weekly', 'targets', 'inventory', 'refunds', 'reviews', 'product_images', 'meta', 'business_actions'];
            
            stores.forEach(storeName => {
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName);
                }
            });
        };
    });
};

export const saveToDB = async (storeName: string, data: any) => {
        const db = await openDatabase();
        try {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        store.put(data, 'main_data'); // Overwrite with key 'main_data'
        
        await new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('数据库写入已中止'));
        });
        } finally { db.close(); }
};

/** Replace all imported datasets in one IndexedDB transaction. A rejected transaction
 * leaves the previous import intact. Action records live in a separate store. */
export const replaceImportedData = async (data: Record<string, unknown>): Promise<void> => {
    const stores = ['monthly', 'weekly', 'targets', 'inventory', 'refunds', 'reviews', 'product_images', 'meta', 'business_actions'];
    const db = await openDatabase();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction(stores, 'readwrite');
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error('导入事务失败'));
            transaction.onabort = () => reject(transaction.error || new Error('导入事务已中止'));
            for (const store of stores) {
                if (store === 'business_actions' && !Object.hasOwn(data, store)) continue;
                transaction.objectStore(store).put(data[store] ?? [], 'main_data');
            }
        });
    } finally { db.close(); }
};

export const loadFromDB = async (storeName: string): Promise<any | null> => {
    try {
        const db = await openDatabase();
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get('main_data');
        
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        // console.warn(`Failed to load ${storeName}`, e); // Suppress warnings for clean console
        return null;
    }
};

export const clearDB = async () => {
    {
        const db = await openDatabase();
        try {
        const dataStores = ['monthly', 'weekly', 'targets', 'inventory', 'refunds', 'reviews', 'product_images', 'meta'];
        const transaction = db.transaction(dataStores, 'readwrite');
        
        dataStores.forEach(name => {
            if (db.objectStoreNames.contains(name)) {
                transaction.objectStore(name).clear();
            }
        });

        await new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('数据库清空已中止'));
        });
        } finally { db.close(); }
    }
};
