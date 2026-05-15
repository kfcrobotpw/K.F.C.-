import { Timestamp } from 'firebase/firestore';

export interface Part {
  id: string;
  name: string;
  category: string;
  totalStock: number;
  availableStock: number;
  description?: string;
  imageUrl?: string;
  status?: 'available' | 'incoming';
}

export interface RestockNews {
  id: string;
  partName: string;
  quantity: number;
  imageUrl?: string;
  createdAt: Timestamp;
}

export interface Rental {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  userPhone: string;
  quantity: number;
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

export interface PurchaseRequest {
  id: string;
  userId: string;
  userEmail: string;
  itemName: string;
  link: string;
  price: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Timestamp;
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
