export interface JobItem {
  id: string;
  brandNameAr: string;
  brandNameEn: string;
  bottleMl: number;
  bottlesPerPack: number;
  qtyPacks: number;
  deliveredQtyPacks: number | null;
}

export type DeliveryStatus = "ASSIGNED" | "EN_ROUTE" | "ARRIVED" | "DELIVERED" | "FAILED";
export type PhotoKind = "BRAND_LABEL" | "DELIVERED_GOODS" | "SITE" | "FAILURE";

export interface Job {
  id: string;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  deliveryStatus: DeliveryStatus;
  attempts: number;
  supplier: { nameAr: string; nameEn: string };
  donor: string | null;
  anonymous: boolean;
  selfUse: boolean;
  window: { start: string; end: string };
  district: { nameAr: string; nameEn: string };
  radiusM: number;
  destination: {
    lat: number;
    lng: number;
    nationalAddress: string | null;
    landmark: string | null;
    accessNotes: string | null;
    recipientName: string | null;
    recipientMobile: string | null;
  };
  proposedPin: { lat: number; lng: number; note: string | null } | null;
  items: JobItem[];
  startedAt: string | null;
  arrivedAt: string | null;
  deliveredAt: string | null;
  codeSent: boolean;
  codeVerified: boolean;
  codeSendsLeft: number;
  photos: { id: string; clientId: string; kind: PhotoKind }[];
  lastFailure: string | null;
  proofSubmitted: boolean;
  note: string | null;
}

export interface JobsResponse {
  ackRequired: boolean;
  driverName: string | null;
  jobs: Job[];
  history: Job[];
}

export interface AckDoc {
  version: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  legalReviewed: boolean;
}

export interface LocalPhoto {
  clientId: string;
  kind: PhotoKind;
  blob: Blob;
}

/** A job as the phone sees it: server data plus whatever is queued but not yet sent. */
export interface ViewJob extends Job {
  pendingPhotos: LocalPhoto[];
  pendingCount: number;
  pendingConfirm: boolean;
}

export interface Fix {
  lat: number;
  lng: number;
  accuracyM: number;
  at: number;
}
