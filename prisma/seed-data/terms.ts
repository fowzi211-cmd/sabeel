// DRAFT agreement texts (v1.0). They are seeded WITHOUT a "legal review completed" mark:
// the admin console shows a warning banner until a super-admin confirms counsel has approved
// them. Bracketed items [...] are placeholders for facts only the owner/counsel can supply.
// The fee amount below must match the GLOBAL FeeRule (50 halalas) seeded with it.

export interface SeedTerms {
  type: "SUPPLIER_AGREEMENT" | "INDEPENDENT_AGREEMENT" | "BUYER_TERMS" | "DRIVER_ACK";
  version: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
}

const supplierAr = `## ١. الأطراف ودور المنصة
تُبرم هذه الاتفاقية بين [اسم الجهة المشغّلة لمنصة سبيل — سجل تجاري رقم ____] («سبيل») والمورّد الذي تظهر بياناته في حسابه («المورّد»). سبيل وسيط إلكتروني يربط المشترين والمتبرعين بموردي المياه المعبأة. سبيل ليست بائعة للمياه، ولا تستلم أموال المشترين ولا تحتفظ بها ولا تنقلها، ولا تضمن سداد المشتري ولا أداء المورّد.

## ٢. صحة البيانات والوثائق
يقرّ المورّد بأن بياناته ووثائقه (السجل التجاري، الرقم الضريبي، التراخيص، شهادات الجودة، الحساب البنكي) صحيحة وسارية، ويلتزم بتحديثها فور تغيّرها. انتهاء أي وثيقة يؤدي تلقائياً إلى إخفاء المنتجات المتأثرة، وقد يؤدي إلى إيقاف استقبال الطلبات مؤقتاً.

## ٣. العلامات الأصلية المسجّلة فقط
لا يعرض المورّد إلا مياهاً من العلامات المسجّلة في سجل العلامات لدى سبيل. يُمنع منعاً باتاً عرض مياه غير معلّمة أو معاد تعبئتها أو مقلّدة أو منتهية الصلاحية أو قريبة الانتهاء دون الحد الأدنى المتفق عليه. يقدّم المورّد عند الطلب ما يثبت مصدر البضاعة (فواتير الشراء من العلامة أو موزّعها المعتمد). لسبيل تجميد أي عرض أو علامة فوراً عند ورود بلاغ عن تقليد أو مخالفة، وعلى المورّد التعاون التام في أي سحب أو استرجاع.

## ٤. الطلبات والتسليم وإثباته
يقبل المورّد الطلب أو يرفضه خلال المهلة المحددة، وإذا قبله التزم بتسليمه بالعلامة والكمية والموعد المتفق عليه. يُوثَّق التسليم دائماً بصور تُلتقط من داخل التطبيق وتُظهر ملصق العلامة ورقم الدفعة أو تاريخ الانتهاء، وبالموقع الجغرافي، وبالكميات المسلّمة، وبرمز المستلم. لا يُعدّ الطلب مكتملاً إلا بتأكيد السائق وتأكيد المشتري.

## ٥. الدفع من المشتري إلى المورّد مباشرة
يدفع المشتري ثمن الطلب مباشرة إلى الحساب البنكي التجاري المسجّل للمورّد بعد تأكيد التسليم من الطرفين، ويؤكد المورّد استلام الدفعة داخل المنصة. يتحمل المورّد مخاطر عدم سداد المشتري، وتتوسط سبيل للمساعدة دون ضمان. يصدر المورّد للمشتري الفاتورة الضريبية النظامية عن البضاعة.

## ٦. رسوم المنصة
يدفع المورّد لسبيل رسماً قدره ٠٫٥٠ ريال سعودي (خمسون هللة) عن كل عبوة (٢٠ قارورة) مُسلَّمة فعلياً، مضافاً إليه ضريبة القيمة المضافة. تُحتسب الرسوم من سجلات سبيل وحدها (الكميات المسلّمة وتأكيد الطرفين) وتُستحق باكتمال التأكيدين ولو تأخر المشتري في الدفع. تصدر فاتورة رسوم شهرية (وأسبوعية في الفواتير الأولى للموردين الجدد والمستقلين) تُسدَّد خلال ٧ أيام إلى الحساب البنكي التجاري لسبيل. يوضع للمورّد سقف للرسوم غير المسدّدة، وعند بلوغه تتوقف الطلبات الجديدة مؤقتاً مع استكمال الطلبات المقبولة. عند التأخر عن السداد يجوز لسبيل إيقاف الطلبات الجديدة ثم تعليق الحساب، وتبقى الرسوم المستحقة ديناً على المورّد. للمورّد الاعتراض بأدلة على بنود الفاتورة خلال ٧ أيام من صدورها. لا تُعدَّل الرسوم إلا بإشعار مسبق مدته ٣٠ يوماً وبقبول جديد من المورّد.

## ٧. عدم الالتفاف على المنصة
لا يجوز للمورّد نقل الطلبات أو العملاء الذين عرّفته بهم سبيل إلى خارج المنصة لتفادي الرسوم، ولا طلب أرقام المتبرعين أو بياناتهم الشخصية. يُعدّ ذلك مخالفة جسيمة توجب التعليق، وتُستحق الرسوم كما لو نُفّذت الطلبات داخل المنصة.

## ٨. التقييمات
يحق للمشترين الموثّقين تقييم المورّد بعد التسليم. للمورّد الرد على التقييم مرة واحدة، ولا يملك حذفه أو تعديله. لا تُزال التقييمات إلا إذا كانت مسيئة أو مزيّفة وفق سياسة الإشراف.

## ٩. حماية البيانات
يستخدم المورّد بيانات المستلمين والمشترين للتسليم فقط، ولا يجوز استخدامها للتسويق أو مشاركتها مع أي طرف، ويلتزم بنظام حماية البيانات الشخصية في المملكة. تُخفى بيانات المستلم بعد ٣٠ يوماً من إغلاق الطلب.

## ١٠. التعليق والإنهاء
يجوز لسبيل إيقاف الحساب أو تعليقه أو إنهاؤه عند مخالفة هذه الاتفاقية أو الإخلال بالجودة أو الأصالة أو تكرار الشكاوى. تُستكمل الطلبات القائمة قدر الإمكان حمايةً للمتبرعين والمستلمين، وتبقى الرسوم المستحقة واجبة السداد.

## ١١. القبول الإلكتروني
يقرّ الموقّع بأن رمز التحقق المرسل إلى جواله وإقراره بالموافقة يُعدّان توقيعاً إلكترونياً ملزماً، وبأن سبيل تحتفظ بسجل القبول (النسخة، بصمة النص، الوقت، عنوان الاتصال) دليلاً على ذلك.

## ١٢. اللغة والقانون المطبق
النص العربي هو المعتمد عند الاختلاف مع أي ترجمة. تخضع هذه الاتفاقية لأنظمة المملكة العربية السعودية، ويُرجع في تسوية النزاعات إلى [الجهة القضائية أو التحكيمية — يحددها المستشار القانوني].`;

const supplierEn = `## 1. Parties and the role of the platform
This agreement is between [name of the entity operating Sabeel — CR no. ____] ("Sabeel") and the supplier whose details appear in its account (the "Supplier"). Sabeel is an electronic intermediary connecting buyers and donors with suppliers of bottled water. Sabeel does not sell water, does not receive, hold or transfer buyers' money, and does not guarantee the buyer's payment or the Supplier's performance.

## 2. Accuracy of details and documents
The Supplier confirms that its details and documents (commercial registration, VAT number, licences, quality certificates, bank account) are accurate and valid, and will update them as soon as they change. When a document expires, the affected products are hidden automatically and new orders may be paused.

## 3. Genuine registered brands only
The Supplier lists only water of brands registered in Sabeel's Brand Registry. Unbranded, refilled, re-labelled, counterfeit, expired or near-expiry water (below the agreed minimum shelf life) is strictly prohibited. On request the Supplier provides proof of the source of its stock (purchase invoices from the brand or its authorised distributor). Sabeel may freeze any listing or brand immediately upon a report of counterfeiting or breach, and the Supplier must fully cooperate in any withdrawal or recall.

## 4. Orders, delivery and proof of delivery
The Supplier accepts or declines an order within the set time; once accepted it must deliver the agreed brand, quantity and time. Delivery is always documented with photos taken inside the app showing the brand label and the batch number or expiry date, with the geographic location, the delivered quantities and the recipient's code. An order is complete only when both the driver and the buyer have confirmed.

## 5. Payment from the buyer directly to the Supplier
After both parties confirm delivery, the buyer pays the order price directly into the Supplier's registered business bank account, and the Supplier confirms receipt inside the platform. The Supplier bears the risk of the buyer not paying; Sabeel may help mediate without any guarantee. The Supplier issues the buyer the statutory tax invoice for the goods.

## 6. Platform fee
The Supplier pays Sabeel a fee of SAR 0.50 (fifty halalas) for each packet (20 bottles) actually delivered, plus VAT. The fee is calculated from Sabeel's own records alone (delivered quantities and both confirmations) and becomes due once both confirmations are complete, even if the buyer pays late. A fee invoice is issued monthly (weekly for the first invoices of new and independent suppliers) and is payable within 7 days into Sabeel's business bank account. A ceiling applies to unpaid fees; on reaching it new orders pause while accepted orders are still completed. If payment is late Sabeel may pause new orders and then suspend the account, and the fees due remain a debt of the Supplier. The Supplier may dispute invoice lines with evidence within 7 days of issue. The fee changes only with 30 days' prior notice and the Supplier's new acceptance.

## 7. No circumvention
The Supplier will not move orders or customers introduced by Sabeel outside the platform to avoid fees, nor ask for donors' phone numbers or personal data. This is a serious breach that warrants suspension, and fees remain due as if the orders had been fulfilled on the platform.

## 8. Reviews
Verified buyers may review the Supplier after delivery. The Supplier may reply once to a review and may not delete or edit it. Reviews are removed only if abusive or fake under the moderation policy.

## 9. Data protection
The Supplier uses recipients' and buyers' data only to deliver, never for marketing or sharing, and complies with the Kingdom's Personal Data Protection Law. Recipient details are masked 30 days after an order closes.

## 10. Suspension and termination
Sabeel may pause, suspend or terminate the account for breach of this agreement, failures of quality or authenticity, or repeated complaints. Open orders are completed where possible to protect donors and recipients, and fees due remain payable.

## 11. Electronic acceptance
The signatory acknowledges that the one-time code sent to their mobile and their confirmation of acceptance are a binding electronic signature, and that Sabeel keeps the acceptance record (version, text hash, time, connection address) as evidence.

## 12. Language and governing law
The Arabic text prevails over any translation. This agreement is governed by the laws of the Kingdom of Saudi Arabia; disputes are referred to [court or arbitration body — to be specified by counsel].`;

const independentAddendumAr = `

## ١٣. أحكام إضافية للموزّع المستقل
يقرّ الموزّع المستقل بأنه يتعامل بصفته الشخصية أو منشأة فردية مسجّلة، وبأن هويته ورخصة القيادة واستمارة المركبة سارية وصحيحة. يخضع أول ١٠ عمليات تسليم لفترة اختبار تُحدّ فيها قيمة الطلبات وتُدقَّق صور التسليم بنسبة كاملة. يقدّم الموزّع عند كل تجديد للمخزون فاتورة شراء من العلامة أو موزّعها المعتمد، ولا يجوز له عرض كميات تزيد على ما تثبته فواتيره. يتحمل مسؤولية سلامة المركبة والسائق ونقل المياه وفق الاشتراطات النظامية.`;

const independentAddendumEn = `

## 13. Additional terms for independent distributors
The independent distributor acts in a personal capacity or as a registered sole trader and confirms that their ID, driving licence and vehicle registration are valid. The first 10 deliveries are a probation period in which order values are capped and all delivery photos are audited. At every restock the distributor provides a purchase invoice from the brand or its authorised distributor and may not list quantities beyond what those invoices prove. The distributor is responsible for the safety of the vehicle and driver and for transporting water in line with the applicable requirements.`;

const buyerAr = `## ١. دور المنصة
سبيل وسيط إلكتروني يتيح لك طلب مياه معبأة من موردين موثّقين لنفسك أو للتبرع بها لمستلمين تحددهم. سبيل ليست جمعية خيرية، ولا تطلب تبرعات ولا تستلم أموالاً منك ولا تحتفظ بها. الطلب بغرض التبرع هو عملية شراء وتوصيل للمياه.

## ٢. حسابك
تسجّل بجوال سعودي صحيح وتحافظ على سرّية رموز التحقق. أنت مسؤول عن الطلبات المنفّذة من حسابك.

## ٣. الطلب والتأكيد
لا يُطلب منك أي دفع عند إتمام الطلب. بعد التسليم يوثّق السائق الاستلام بالصور ويصلك تقرير التسليم، وتؤكد استلامك أو تُبلغ عن مشكلة. لا يُفتح الدفع للمورّد إلا بعد تأكيدك وتأكيد السائق.

## ٤. الدفع
تدفع للمورّد مباشرة في حسابه البنكي التجاري الظاهر في التطبيق فقط، وتكتب رقم العملية في ملاحظة التحويل. لا تدفع لسبيل ولن تطلب منك ذلك. تتحمل عدم السداد في الوقت المحدد بحدود الطلبات الجديدة ومستوى الثقة الخاص بحسابك.

## ٥. الخصوصية
يرى المورّد والسائق اسمك الأول فقط (أو «متبرع مجهول» إذا اخترت ذلك) ولا يريان اسمك الكامل ولا جوالك. يُشارَك اسم المستلم وجواله مع المورّد والسائق لغرض التسليم فقط، وتُخفى بعد ٣٠ يوماً من إغلاق الطلب.

## ٦. التقييمات
يحق لك تقييم المورّد بعد التسليم بصدق. تُزال التقييمات المسيئة أو المزيّفة وفق سياسة الإشراف.

## ٧. إيقاف الحساب
يجوز لسبيل تقييد الحساب أو إيقافه عند إساءة الاستخدام أو التأخر المتكرر في السداد أو تقديم بيانات غير صحيحة.

## ٨. اللغة والقانون
النص العربي هو المعتمد. تخضع هذه الشروط لأنظمة المملكة العربية السعودية.`;

const buyerEn = `## 1. Role of the platform
Sabeel is an electronic intermediary that lets you order bottled water from verified suppliers for yourself or to donate to recipients you choose. Sabeel is not a charity, does not solicit donations, and does not receive or hold your money. An order made as a donation is a purchase and delivery of water.

## 2. Your account
You register with a valid Saudi mobile number and keep your verification codes secret. You are responsible for orders placed from your account.

## 3. Ordering and confirmation
You are not asked to pay anything when you place an order. After delivery the driver documents it with photos and you receive a delivery report, then you confirm receipt or report a problem. Payment to the supplier opens only after both you and the driver have confirmed.

## 4. Payment
You pay the supplier directly, only into the business bank account shown in the app, and write the transaction number in the transfer note. You do not pay Sabeel and Sabeel will never ask you to. Late payment limits your new orders and your account's trust level.

## 5. Privacy
The supplier and driver see only your first name (or "Anonymous donor" if you choose) and never your full name or mobile. The recipient's name and mobile are shared with the supplier and driver for delivery only and are masked 30 days after the order closes.

## 6. Reviews
You may honestly review the supplier after delivery. Abusive or fake reviews are removed under the moderation policy.

## 7. Suspension
Sabeel may restrict or suspend an account for misuse, repeated late payment or false information.

## 8. Language and law
The Arabic text prevails. These terms are governed by the laws of the Kingdom of Saudi Arabia.`;

const driverAr = `## ١. الغرض
هذا إقرار قصير يوقّعه السائق قبل أن يوصّل أي طلب عبر منصة سبيل. سبيل وسيط إلكتروني؛ والسائق يعمل لدى المورّد الذي أضافه أو يعمل لحسابه إن كان موزّعاً مستقلاً.

## ٢. الالتزام بالتوصيل الصحيح
أوصّل الطلب المسنَد إليّ إلى العنوان المحدد في الموعد المتفق عليه، وبالعلامة والكمية المسجّلة، ولا أسلّم مياهاً مختلفة عن المذكورة في الطلب. إن تعذّر التسليم أو اختلفت الكمية سجّلتُ ذلك في التطبيق بصدق.

## ٣. إثبات التسليم
ألتقط صور الإثبات من داخل التطبيق وحده ولا أستعمل صوراً قديمة أو من الاستوديو أو من غير موقع التسليم. أُظهر في إحدى الصور ملصق العلامة ورقم الدفعة أو تاريخ الانتهاء. لا أطلب رمز الاستلام من المستلم إلا عند وصول المياه، ولا أدخل رمزاً لم يُعطَ لي فعلاً. تسجيل تسليم لم يحدث مخالفة جسيمة قد تؤدي إلى الإيقاف والمساءلة.

## ٤. الخصوصية
أرى اسم المستلم ورقمه وموقعه لغرض التسليم فقط. لا أحتفظ بهذه البيانات ولا أشاركها ولا أتواصل مع المستلم لغير التسليم. لا أصوّر أشخاصاً أو أطفالاً، وإن ظهر شخص في الصورة فبموافقته. لا أطلب من المتبرع أي بيانات ولا أعرف هويته.

## ٥. الموقع الجغرافي
يستخدم التطبيق موقعي أثناء التوصيل فقط لإثبات الوصول، ولا يُجمع موقعي خارج ذلك.

## ٦. لا أموال ولا إكراميات
لا أستلم أي مبلغ من المستلم أو المتبرع باسم سبيل. الدفع يتم بين المشتري والمورّد مباشرة.

## ٧. القانون واللغة
يسود النص العربي وتخضع هذه الشروط لأنظمة المملكة العربية السعودية.`;

const driverEn = `## 1. Purpose
A short acknowledgement each driver signs before delivering any order through Sabeel. Sabeel is an online intermediary; the driver works for the supplier who added them, or for themself if they are an independent distributor.

## 2. Deliver what was ordered
I deliver the order assigned to me to the stated address in the agreed window, with the registered brand and quantity, and never a different water. If delivery fails or the quantity differs, I record it honestly in the app.

## 3. Proof of delivery
I take proof photos inside the app only — no old photos, no gallery images, nothing from another place. One photo shows the brand label and batch number or expiry date. I ask for the recipient's code only when the water has arrived and never enter a code I was not really given. Recording a delivery that did not happen is a serious breach that can lead to suspension and liability.

## 4. Privacy
I see the recipient's name, number and location only to deliver. I do not keep or share them, or contact the recipient for anything but the delivery. I do not photograph people or children; if a person appears in a photo it is with their consent. I never ask the donor for any data and I do not know who they are.

## 5. Location
The app uses my location during a delivery only, to prove arrival. It is not collected otherwise.

## 6. No money, no tips
I do not collect any payment from the recipient or donor on Sabeel's behalf. Payment is between the buyer and the supplier directly.

## 7. Language and law
The Arabic text prevails. These terms are governed by the laws of the Kingdom of Saudi Arabia.`;

export const SEED_TERMS: SeedTerms[] = [
  {
    type: "SUPPLIER_AGREEMENT",
    version: "1.0",
    titleAr: "اتفاقية المورّد على منصة سبيل",
    titleEn: "Sabeel Supplier Agreement",
    bodyAr: supplierAr,
    bodyEn: supplierEn,
  },
  {
    type: "INDEPENDENT_AGREEMENT",
    version: "1.0",
    titleAr: "اتفاقية الموزّع المستقل على منصة سبيل",
    titleEn: "Sabeel Independent Distributor Agreement",
    bodyAr: supplierAr + independentAddendumAr,
    bodyEn: supplierEn + independentAddendumEn,
  },
  {
    type: "BUYER_TERMS",
    version: "1.0",
    titleAr: "شروط استخدام سبيل للمشترين والمتبرعين",
    titleEn: "Sabeel Terms for Buyers and Donors",
    bodyAr: buyerAr,
    bodyEn: buyerEn,
  },
  {
    type: "DRIVER_ACK",
    version: "1.0",
    titleAr: "إقرار السائق وقواعد إثبات التسليم",
    titleEn: "Driver Acknowledgement and Proof-of-Delivery Rules",
    bodyAr: driverAr,
    bodyEn: driverEn,
  },
];
