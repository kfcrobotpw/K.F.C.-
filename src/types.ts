import { Timestamp } from 'firebase/firestore';

export interface Part {
  id: string;
  name: string;
  category: string;
  totalStock: number;
  availableStock: number;
  description?: string;
}

export interface Rental {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  userPhone: string;
  partId: string;
  partName: string;
  status: 'borrowed' | 'returned';
  borrowedAt: Timestamp;
  returnedAt?: Timestamp;
}

export interface AdminLog {
  id: string;
  userId: string;
  userEmail: string;
  displayName: string;
  timestamp: Timestamp;
}

export const CATEGORIES = [
  '센서 (Sensors)',
  '모터 (Motors)',
  '빔 (Beams)',
  '커넥터 (Connectors)',
  '기어 (Gears)',
  '바퀴 (Wheels)',
  '기타 (Other)'
];
