
import { DataRow, InventoryRow, RefundRow, ReviewRow, TargetRow, FilterState } from './types';

// We use native IndexedDB API directly to avoid external dependency issues in some environments.
// Removed 'idb' import as we are implementing the wrapper manually below.

const DB_NAME = 'AmazonDashboardDB';
const DB_VERSION = 2; // Bumped version to ensure object stores are created if missing

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
            const stores = ['monthly', 'weekly', 'targets', 'inventory', 'refunds', 'reviews', 'meta'];
            
            stores.forEach(storeName => {
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName);
                }
            });
        };
    });
};

export const saveToDB = async (storeName: string, data: any) => {
    try {
        const db = await openDatabase();
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        store.put(data, 'main_data'); // Overwrite with key 'main_data'
        
        return new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (e) {
        console.error(`Failed to save ${storeName}`, e);
    }
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
    try {
        const db = await openDatabase();
        const stores = ['monthly', 'weekly', 'targets', 'inventory', 'refunds', 'reviews', 'meta'];
        const transaction = db.transaction(stores, 'readwrite');
        
        stores.forEach(name => {
            if (db.objectStoreNames.contains(name)) {
                transaction.objectStore(name).clear();
            }
        });

        return new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (e) {
        console.error("Failed to clear DB", e);
    }
};
