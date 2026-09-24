// Every user-visible error carries an Arabic and an English message, plus a stable code
// that clients and tests can rely on (design pack §9 conventions).

export const ERRORS = {
  BAD_REQUEST: { status: 400, ar: "الطلب غير صحيح.", en: "Invalid request." },
  VALIDATION: { status: 422, ar: "بعض الحقول غير صحيحة.", en: "Some fields are invalid." },
  UNAUTHENTICATED: { status: 401, ar: "يرجى تسجيل الدخول.", en: "Please sign in." },
  FORBIDDEN: { status: 403, ar: "لا تملك صلاحية لهذا الإجراء.", en: "You are not allowed to do this." },
  MFA_REQUIRED: {
    status: 403,
    ar: "يلزم التحقق بخطوتين للمتابعة.",
    en: "Two-step verification is required to continue.",
  },
  NOT_FOUND: { status: 404, ar: "غير موجود.", en: "Not found." },
  CONFLICT: { status: 409, ar: "تعارض مع بيانات موجودة.", en: "Conflicts with existing data." },
  RATE_LIMITED: {
    status: 429,
    ar: "محاولات كثيرة. حاول لاحقاً.",
    en: "Too many attempts. Please try again later.",
  },
  OTP_COOLDOWN: {
    status: 429,
    ar: "انتظر قليلاً قبل طلب رمز جديد.",
    en: "Please wait a moment before requesting a new code.",
  },
  OTP_INVALID: { status: 400, ar: "الرمز غير صحيح أو منتهي.", en: "The code is wrong or has expired." },
  OTP_LOCKED: {
    status: 429,
    ar: "تجاوزت عدد المحاولات. اطلب رمزاً جديداً.",
    en: "Too many wrong attempts. Request a new code.",
  },
  MOBILE_INVALID: {
    status: 422,
    ar: "أدخل رقم جوال سعودي صحيح (05xxxxxxxx).",
    en: "Enter a valid Saudi mobile number (05xxxxxxxx).",
  },
  TOTP_INVALID: { status: 400, ar: "رمز التحقق بخطوتين غير صحيح.", en: "The two-step code is wrong." },
  ACCOUNT_BLOCKED: { status: 403, ar: "هذا الحساب موقوف.", en: "This account is blocked." },
  SMS_UNAVAILABLE: {
    status: 503,
    ar: "خدمة الرسائل غير متاحة حالياً.",
    en: "The SMS service is currently unavailable.",
  },
  FILE_INVALID: {
    status: 422,
    ar: "الملف غير مقبول (PDF أو صورة حتى 8 ميغابايت).",
    en: "File not accepted (PDF or image, up to 8 MB).",
  },
  NOT_EDITABLE: {
    status: 409,
    ar: "لا يمكن التعديل في الحالة الحالية.",
    en: "This cannot be edited in its current state.",
  },
  INCOMPLETE: {
    status: 422,
    ar: "الطلب غير مكتمل بعد.",
    en: "The application is not complete yet.",
  },
  TERMS_NOT_FOUND: {
    status: 404,
    ar: "لا توجد نسخة منشورة من هذه الاتفاقية.",
    en: "No published version of this agreement exists.",
  },
  TERMS_STALE: {
    status: 409,
    ar: "صدرت نسخة أحدث من الاتفاقية. أعد قراءتها.",
    en: "A newer version of the agreement was published. Please read it again.",
  },
  TERMS_REQUIRED: {
    status: 403,
    ar: "وافق على شروط الاستخدام أولاً من صفحة حسابك.",
    en: "Please accept the terms of use from your account page first.",
  },
  PROFILE_INCOMPLETE: {
    status: 422,
    ar: "أضف اسمك الكامل في حسابك أولاً.",
    en: "Add your full name to your account first.",
  },
  ACCOUNT_RESTRICTED: {
    status: 403,
    ar: "حسابك مقيّد مؤقتاً عن الطلبات الجديدة.",
    en: "Your account is temporarily restricted from new orders.",
  },
  ORDER_LIMIT: {
    status: 422,
    ar: "قيمة الطلب تتجاوز حدّ حسابك الحالي.",
    en: "This order is above your account's current limit.",
  },
  RESTRICTED_ZONE: {
    status: 422,
    ar: "لا يتوفر التوصيل إلى هذه المنطقة حالياً.",
    en: "Delivery to this area is not available.",
  },
  NOT_SERVED: {
    status: 422,
    ar: "هذا المورّد لا يخدم المنطقة المختارة.",
    en: "This supplier does not serve the chosen area.",
  },
  OFFER_UNAVAILABLE: {
    status: 409,
    ar: "العرض لم يعد متاحاً أو تغيّر. حدّث النتائج.",
    en: "The offer is no longer available or has changed. Refresh the results.",
  },
  SLOT_INVALID: {
    status: 409,
    ar: "موعد التوصيل المختار لم يعد متاحاً. اختر موعداً آخر.",
    en: "That delivery window is no longer available. Pick another.",
  },
  SUPPLIER_NOT_ACTIVE: {
    status: 403,
    ar: "لا يمكن إدارة الكتالوج إلا بعد اعتماد حسابك كمورّد.",
    en: "The catalogue can only be managed once your supplier account is approved.",
  },
  BRAND_NOT_ALLOWED: {
    status: 422,
    ar: "العلامة غير مسجّلة أو مجمّدة في سجل العلامات.",
    en: "That brand is not in the registry or has been frozen.",
  },
  AGREEMENT_REQUIRED: {
    status: 403,
    ar: "يجب قبول أحدث نسخة من اتفاقية المورّد قبل قبول الطلبات.",
    en: "Accept the current supplier agreement before accepting orders.",
  },
  DOCS_EXPIRED: {
    status: 403,
    ar: "إحدى وثائقك منتهية الصلاحية. حدّثها لتستقبل الطلبات.",
    en: "One of your documents has expired. Renew it to receive orders.",
  },
  OFFER_EXPIRED: {
    status: 409,
    ar: "انتهت مهلة قبول هذا الطلب وأُعيد توجيهه.",
    en: "The time to accept this order ran out and it was re-routed.",
  },
  INVALID_STATE: {
    status: 409,
    ar: "هذه الخطوة غير ممكنة في حالة الطلب الحالية.",
    en: "That step is not possible in the order's current state.",
  },
  DRIVER_INVALID: {
    status: 422,
    ar: "السائق غير صالح أو غير نشط.",
    en: "That driver is not valid or not active.",
  },
  DRIVER_BUSY: {
    status: 409,
    ar: "لا يمكن إيقاف السائق وله توصيلات جارية. أعد إسنادها أولاً.",
    en: "This driver has deliveries in progress. Reassign them first.",
  },
  DRIVER_ACK_REQUIRED: {
    status: 403,
    ar: "وافق على إقرار السائق أولاً.",
    en: "Please accept the driver acknowledgement first.",
  },
  PROOF_INCOMPLETE: {
    status: 422,
    ar: "إثبات التسليم غير مكتمل.",
    en: "The proof of delivery is not complete.",
  },
  PHOTO_INVALID: {
    status: 422,
    ar: "الصورة غير مقبولة (JPEG أو PNG حتى 8 ميغابايت).",
    en: "Photo not accepted (JPEG or PNG, up to 8 MB).",
  },
  NO_ELIGIBLE: {
    status: 422,
    ar: "لا يوجد مورّد مؤهل لهذا الطلب حالياً.",
    en: "No eligible supplier is available for this order right now.",
  },
  MAX_ATTEMPTS: {
    status: 409,
    ar: "بلغ الطلب الحد الأقصى لمحاولات التوصيل.",
    en: "This order has reached the maximum number of delivery attempts.",
  },
  PAYMENT_OVERDUE: {
    status: 403,
    ar: "لديك دفعة متأخرة لمورّد. سدّدها لتتمكن من الطلب مجدداً.",
    en: "You have an overdue payment to a supplier. Settle it before ordering again.",
  },
  DISPUTE_OPEN: {
    status: 409,
    ar: "يوجد نزاع مفتوح على هذا الطلب حالياً.",
    en: "A dispute is already open on this order.",
  },
  REVIEW_WINDOW_CLOSED: {
    status: 409,
    ar: "انتهت مهلة تقييم هذا الطلب.",
    en: "The window to review this order has closed.",
  },
  ALREADY_REVIEWED: {
    status: 409,
    ar: "لقد قيّمت هذا الطلب من قبل.",
    en: "You have already reviewed this order.",
  },
  ALREADY_REPLIED: {
    status: 409,
    ar: "رددت على هذا التقييم من قبل.",
    en: "You have already replied to this review.",
  },
  ALREADY_FLAGGED: {
    status: 409,
    ar: "سبق الإبلاغ عن هذا التقييم.",
    en: "This review has already been flagged.",
  },
  INTERNAL: { status: 500, ar: "حدث خطأ غير متوقع.", en: "Something went wrong." },
} as const;

export type ErrorCode = keyof typeof ERRORS;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, opts?: { field?: string; details?: Record<string, unknown>; message?: string }) {
    super(opts?.message ?? ERRORS[code].en);
    this.code = code;
    this.field = opts?.field;
    this.details = opts?.details;
  }

  get status(): number {
    return ERRORS[this.code].status;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message_ar: ERRORS[this.code].ar,
        message_en: ERRORS[this.code].en,
        ...(this.field ? { field: this.field } : {}),
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}
