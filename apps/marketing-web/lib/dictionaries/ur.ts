import type { MessageKey } from "../i18n";

/**
 * Urdu marketing candidate translations (Session 13). Status: DRAFT —
 * PROFESSIONAL REVIEW REQUIRED (+ RTL layout review). Staging-only draft routes
 * (noindexed); never emitted by a production build until reviewed. Rendered
 * under dir="rtl" (set on <html> by the locale layout). Embedded LTR runs
 * (Medicine Passport, MediDocs, QR, English, numerals, Glucomet 500) rely on
 * the Unicode bidi algorithm; verified visually on staging. No Nastaliq webfont
 * (§22) — approved system/Noto stack only. the clinics and lead strings stay English.
 */
export const ur: Record<MessageKey, string> = {
  "brand.name": "Medicine Passport",
  "brand.endorsement": "بذریعہ MediDocs",
  "brand.company_line": "MediDocs",

  "nav.help": "مدد",
  "nav.for_clinics": "ڈاکٹروں اور کلینک کے لیے",
  "nav.skip": "مرکزی مواد پر جائیں",

  "header.cta": "میرا مفت Medicine Passport بنائیں",
  "header.cta_short": "مفت شروع کریں",

  "hero.h1": "آپ کی دوائیں۔ ایک جگہ۔ آپ کی زبان میں۔",
  "hero.sub":
    "آپ کیا لیتے ہیں، کیوں لیتے ہیں، کب لیتے ہیں، اور ڈاکٹر کو کیا دکھانا ہے — جہاں بھی جائیں، سب یاد رکھیں۔",
  "hero.chip_free": "تمام مریضوں کے لیے مفت",
  "hero.chip_no_install": "کوئی ایپ انسٹال نہیں کرنی",
  "hero.chip_languages": "ایپ کی زبانیں: English · हिंदी · తెలుగు · اردو",
  "hero.cta": "میرا مفت Medicine Passport بنائیں",
  "hero.secondary": "دیکھیں یہ کیسے کام کرتا ہے",
  "hero.media_label": "پروڈکٹ کا مظاہرہ",
  "hero.media_note": "اصل ایپ کی ویڈیو میڈیا تیار ہونے پر آئے گی۔",

  "problem.h2": "کیا یہ جانا پہچانا لگتا ہے؟",
  "problem.a_title": "“آپ کون سی دوائیں لے رہے ہیں؟”",
  "problem.a_body":
    "جب آپ کی کہانی کا ہر حصہ الگ الگ ڈاکٹر کے پاس ہو، تو ایک آسان سوال بھی مشکل ہو جاتا ہے۔ دراز میں دوا کے پتے، فولڈر میں نسخے، فون میں تصویریں — اور ڈاکٹر جواب کا انتظار کرتے ہوئے۔",
  "problem.b_title": "دو نام، ایک ہی جزو",
  "problem.b_body":
    "ڈاکٹر A ایک برانڈ لکھتے ہیں۔ ڈاکٹر B دوسرا۔ دو مختلف برانڈ ناموں میں ایک ہی جزو ہو سکتا ہے — اور خاندان کے لیے یہ جاننا آسان نہیں ہوتا۔",
  "problem.c_title": "دوسرے شہر سے دیکھ بھال",
  "problem.c_body":
    "آپ کے والد کی دوائیں وجے واڑہ میں ہیں۔ آپ بنگلور میں ہیں۔ پچھلی بار کیا بدلا، اس کی یاد ہی واحد ریکارڈ ہے۔",
  "problem.thesis":
    "آپ کی دوا کی معلومات آپ کے ساتھ چلنی چاہیے — نسخوں، ڈاکٹروں، دوا خانوں اور اسپتال کی فائلوں میں بکھری نہیں رہنی چاہیے۔",
  "problem.reveal": "Medicine Passport اسی لیے ہے۔",

  "reveal.h2": "ایک دوا ریکارڈ، جو مریض کا اپنا ہے۔",
  "reveal.body":
    "ہر دوا، ان اہم تفصیلات کے ساتھ: نام، جزو، طاقت، کب اور کیسے لینی ہے، کس ڈاکٹر نے لکھی، اور کیوں — آسان الفاظ میں۔ یہ آپ کا ریکارڈ ہے۔ یہ آپ کے ساتھ جاتا ہے۔",
  "reveal.card_caption": "صرف مثال — یہ اصل اسکرین نہیں ہے۔",
  "reveal.f_name": "دوا",
  "reveal.f_name_v": "Glucomet 500",
  "reveal.f_ingredient": "جزو",
  "reveal.f_ingredient_v": "Metformin 500 mg",
  "reveal.f_schedule": "کب",
  "reveal.f_schedule_v": "صبح اور رات، کھانے کے بعد",
  "reveal.f_doctor": "کس نے لکھی",
  "reveal.f_doctor_v": "Dr. Rao",
  "reveal.f_reason": "آپ کا درج کردہ سبب",
  "reveal.f_reason_v": "بلڈ شوگر",
  "reveal.f_status": "حالت",
  "reveal.f_status_v": "ابھی جاری",

  "know.h2": "جانیں آپ کیا لے رہے ہیں۔",
  "know.body":
    "اپنی دوائیں اپنے طریقے سے شامل کریں: نسخے کی تصویر لیں اور Medicine Passport جو پڑھے اسے جانچیں — محفوظ کرنے سے پہلے ہر بات آپ خود دیکھتے ہیں۔ یا تلاش کر کے دوا ڈھونڈیں، یا خود ٹائپ کریں۔ نسخوں کی تصویریں اور رپورٹیں آپ کے ریکارڈ کے ساتھ جڑی رہتی ہیں۔",
  "know.chip_photo": "تصویر",
  "know.chip_search": "تلاش",
  "know.chip_manual": "خود ٹائپ کریں",
  "know.media_label": "نسخے کی تصویر سے دوا شامل کرنا",

  "remember.h2": "جانیں آگے کیا ہے۔",
  "remember.body":
    "آج کی دوائیں ایک ٹائم لائن پر دیکھیں۔ خوراک کو لی، چھوڑی یا مؤخر کی کے طور پر درج کریں۔ چاہیں تو براؤزر ریمائنڈر آن کریں، اور جانیں کب دوا کم ہو رہی ہے۔ Medicine Passport آج کی دواؤں کو سامنے اور منظم رکھنے میں مدد کرتا ہے۔",
  "remember.chip_timeline": "آج کی ٹائم لائن",
  "remember.chip_reminders": "اختیاری ریمائنڈر",
  "remember.chip_refills": "دوا کم ہونے کی اطلاع",
  "remember.media_label": "آج کی ٹائم لائن اور خوراک درج کرنا",

  "access.h2": "صحت کی معلومات کے لیے بہترین انگریزی، بہترین نظر یا نیا فون ضروری نہیں ہونا چاہیے۔",
  "access.sub": "پڑھیں — یا سنیں۔",
  "access.body":
    "Medicine Passport ایپ English، हिंदी، తెలుగు اور اردو بولتا ہے — بشمول دائیں سے بائیں لکھی جانے والی اردو۔ ایپ میں دی گئی رہنمائی کو Listen بٹن دبا کر سنا جا سکتا ہے۔ بڑے حروف، بڑے بٹن، آسان اسکرینیں — اصل فون اور اصل نیٹ ورک کے لیے۔",
  "access.lang_en": "English",
  "access.lang_hi": "हिंदी",
  "access.lang_te": "తెలుగు",
  "access.lang_ur": "اردو",
  "access.listen": "سنیں",
  "access.media_label": "وہی اسکرین چار زبانوں میں",
  "access.video_label": "ایپ میں پڑھ کر سنانا: Listen دبانا، رہنمائی چلنا، پھر Stop",
  "access.audio_cta": "سنیں Medicine Passport کیسا لگتا ہے",
  "access.audio_stop": "روکیں",
  "access.audio_error": "ابھی آڈیو دستیاب نہیں ہے",
  "access.audio_note": "ایپ کی اصل رہنمائی آواز (English)۔ بٹن دبانے پر ہی چلتی ہے۔",

  "offline.h2": "نیٹ ورک جانے پر آپ کا دوا ریکارڈ غائب نہیں ہونا چاہیے۔",
  "offline.body":
    "آپ کی محفوظ دوائیں انٹرنیٹ کے بغیر بھی نظر آتی ہیں۔ خوراک آف لائن درج کریں — نیٹ ورک آنے پر وہ سنک ہو جاتی ہیں۔ آپ ہمیشہ دیکھ سکتے ہیں کہ آپ آف لائن ہیں، سنک ہو رہا ہے، یا اپ ڈیٹ ہے۔",
  "offline.honest": "ریمائنڈر کے لیے کنکشن ضروری ہے۔",
  "offline.media_label": "آف لائن دیکھنا اور خوراک درج کرنا، پھر سنک",

  "care.h2": "اپنے والدین کی مدد کریں، ان کا اختیار چھینے بغیر۔",
  "care.body":
    "مدد کے لیے خاندان کو بلائیں — اور طے کریں کہ ہر شخص کیا دیکھ یا کر سکتا ہے۔ کہیں سے بھی والدین یا زیرِ کفالت فرد کی دوائیں سنبھالیں۔ ہر نگہداشت کنندہ کی رسائی مریض کو نظر آتی ہے، اور رسائی کبھی بھی ہٹائی جا سکتی ہے۔",
  "care.tagline": "ایسی مدد جو دی جاتی ہے، محدود ہے، نظر آتی ہے — اور ہٹائی جا سکتی ہے۔",
  "care.cta": "اپنے خاندان کے لیے Medicine Passport بنائیں",
  "care.media_label": "نگہداشت کنندہ کو بلانا اور اجازتیں چننا",

  "share.h2": "اپائنٹمنٹ پر کاغذ کا فولڈر نہیں — اپنی دوا فہرست لائیں۔",
  "share.body":
    "QR کوڈ یا لنک سے ایک شیئر بنائیں، جو جتنی دیر آپ چاہیں چلے۔ ڈاکٹر اپنے ہی ڈیوائس پر ایک منظم خلاصہ کھولتے ہیں — نہ MediDocs اکاؤنٹ، نہ کچھ انسٹال کرنا۔ آپ لنک کو کبھی بھی بند کر سکتے ہیں، اور دیکھ سکتے ہیں کہ وہ کب کھولا گیا۔",
  "share.chip_qr": "QR یا لنک",
  "share.chip_expires": "کتنی دیر چلے، آپ طے کریں",
  "share.chip_no_account": "ڈاکٹر کا اکاؤنٹ نہیں چاہیے",
  "share.chip_revocable": "لنک کبھی بھی بند کریں",
  "share.media_label": "شیئر بنانا، اور ڈاکٹر کو نظر آنے والا خلاصہ",

  "bridge.h2": "کیا آپ ڈاکٹر، فارماسسٹ یا کلینک ہیں؟",
  "bridge.body":
    "دیکھیں کہ مریض کے پاس رہنے والا Medicine Passport، جب مریض شیئر کرنا چاہے، تو دوا کی معلومات دیکھنا کیسے آسان بنا سکتا ہے۔",
  "bridge.cta": "صحت کے پیشہ ور افراد کے لیے Medicine Passport",

  "free.h2": "Medicine Passport تمام مریضوں کے لیے مفت ہے۔",
  "free.body":
    "آپ کی دوا کی معلومات آپ کی اپنی ہے۔ Medicine Passport تمام مریضوں کے لیے بنانے، برقرار رکھنے اور دیکھنے کے لیے مفت ہے۔ ہم MediDocs کو صحت کے اداروں کے ساتھ خدمات اور شراکت داری سے چلانے کا ارادہ رکھتے ہیں — مریضوں سے ان کی اپنی دوا معلومات دیکھنے کا معاوضہ لے کر نہیں۔",
  "free.chip_no_ads": "مریض کے تجربے میں کوئی اشتہار نہیں",
  "free.chip_no_paywall": "آپ کے اپنے ریکارڈ پر کوئی ادائیگی کی دیوار نہیں",

  "trust.h2": "آپ کی دواؤں کو سمجھنے میں مدد کے لیے بنایا گیا — آپ کے ڈاکٹر کی جگہ لینے کے لیے نہیں۔",
  "trust.does_h3": "Medicine Passport یہ کرتا ہے",
  "trust.does_1": "آپ کی دوا معلومات کو منظم رکھتا ہے — اور آپ کی اپنی۔",
  "trust.does_2": "آج کی خوراک ایک ٹائم لائن پر دکھاتا ہے، اختیاری براؤزر ریمائنڈر کے ساتھ۔",
  "trust.does_3": "دیکھنے اور درج کرنے کے لیے آف لائن کام کرتا ہے، نیٹ ورک آنے پر سنک کرتا ہے۔",
  "trust.does_4": "آپ کی دی گئی، نظر آنے والی اور ہٹائی جا سکنے والی اجازتوں سے خاندان کو مدد کرنے دیتا ہے۔",
  "trust.not_h3": "Medicine Passport یہ نہیں کرتا",
  "trust.not_1": "یہ نہ مرض کی تشخیص کرتا ہے، نہ دوا لکھتا ہے۔",
  "trust.not_2": "یہ آپ کو دوا شروع یا بند کرنے کو نہیں کہتا۔",
  "trust.not_3": "یہ ایک دوا کی جگہ دوسری تجویز نہیں کرتا۔",
  "trust.not_4": "یہ کسی دوا کو “محفوظ” قرار نہیں دیتا۔",
  "trust.not_5": "یہ ڈاکٹروں یا فارماسسٹوں کی جگہ نہیں لیتا۔",

  "faq.h2": "وہ سوالات جو خاندان واقعی پوچھتے ہیں۔",
  "faq.q1": "کیا Medicine Passport واقعی مفت ہے؟",
  "faq.a1":
    "جی ہاں — تمام مریضوں کے لیے بنانے، برقرار رکھنے اور دیکھنے کے لیے مفت۔ ہم MediDocs کو صحت کے اداروں کے ساتھ خدمات اور شراکت داری سے چلانے کا ارادہ رکھتے ہیں، مریضوں سے معاوضہ لے کر نہیں۔",
  "faq.q2": "کیا مجھے کوئی ایپ انسٹال کرنی ہوگی؟",
  "faq.a2":
    "نہیں۔ Medicine Passport آپ کے فون کے براؤزر میں چلتا ہے۔ چاہیں تو اسے ہوم اسکرین پر شامل کر سکتے ہیں، مگر یہ ضروری نہیں۔",
  "faq.q3": "ایپ کن زبانوں میں دستیاب ہے؟",
  "faq.a3":
    "ایپ English، हिंदी، తెలుగు اور اردو میں دستیاب ہے۔ یہ ویب سائٹ فی الحال English میں ہے؛ ترجمے کے جائزے کے بعد مزید زبانیں آئیں گی۔",
  "faq.q4": "کیا میرا خاندان میری دوائیں سنبھالنے میں مدد کر سکتا ہے؟",
  "faq.a4":
    "جی ہاں۔ کسی خاندانی فرد کو بلائیں اور طے کریں کہ وہ کیا دیکھ یا کر سکتے ہیں۔ آپ ان کی ہر رسائی دیکھ سکتے ہیں، اور رسائی کبھی بھی ہٹا سکتے ہیں۔",
  "faq.q6": "کیا یہ بتا سکتا ہے کہ دو دوائیں ساتھ لینا محفوظ ہے؟",
  "faq.a6":
    "نہیں۔ Medicine Passport دواؤں کے باہمی اثر کی جانچ نہیں کرتا اور کسی امتزاج کو کبھی محفوظ قرار نہیں دیتا۔ دوائیں ساتھ لینے کے سوالات آپ کے ڈاکٹر یا فارماسسٹ کے ہیں۔",
  "faq.q7": "کیا Medicine Passport طبی مشورے کی جگہ لیتا ہے؟",
  "faq.a7":
    "نہیں۔ یہ آپ کی اپنی دوا معلومات رکھنے اور سمجھنے میں مدد کرتا ہے۔ آپ کی دواؤں کے فیصلے ہمیشہ آپ کے ڈاکٹر یا فارماسسٹ کے ہوتے ہیں۔",
  "faq.q8": "اگر میرے پاس انٹرنیٹ نہ ہو تو کیا ہوگا؟",
  "faq.a8":
    "آپ کی محفوظ دوائیں نظر آتی رہتی ہیں، اور آپ خوراک آف لائن درج کر سکتے ہیں — نیٹ ورک آنے پر سب سنک ہو جاتا ہے۔ ریمائنڈر کے لیے کنکشن ضروری ہے۔",
  "faq.q9": "میری معلومات کون دیکھ سکتا ہے؟",
  "faq.a9":
    "آپ کا Medicine Passport عوامی طور پر درج نہیں ہوتا۔ خاندانی نگہداشت کنندگان کو صرف وہی رسائی ملتی ہے جو آپ دیتے ہیں، اور وہ رسائی آپ کبھی بھی ہٹا سکتے ہیں۔",
  "faq.q10": "کیا میں کسی خاندانی فرد کی رسائی ہٹا سکتا ہوں؟",
  "faq.a10":
    "جی ہاں، کبھی بھی۔ نگہداشت کنندہ کی رسائی آپ دیتے ہیں، آپ کو نظر آتی ہے، اور آپ ہی ہٹا سکتے ہیں۔",

  "final.h2": "اپنی دوا معلومات اپنے ساتھ لے جائیں۔",
  "final.sub": "آج ہی اپنا Medicine Passport شروع کریں۔",
  "final.qr": "فون پر کھولنے کے لیے اسکین کریں",

  // /for-clinics/ + lead form stay ENGLISH (English-only V1, §16).
  "clinics.meta_title": "Medicine Passport for doctors & clinics | MediDocs",
  "clinics.meta_description":
    "A free, patient-held medication record. When a patient shares it, you see a structured, patient-confirmed summary in seconds — no account, nothing to install.",
  "clinics.c1_h1": "A clearer medication picture, brought by the patient.",
  "clinics.c1_body":
    "Medicine Passport is a free, patient-held medication record. When a patient shares it, you see a structured, patient-confirmed summary — in seconds, with nothing to install. The patient owns and controls the record.",
  "clinics.c1_cta": "Bring Medicine Passport to your patients",
  "clinics.c1_secondary": "See what patients use",
  "clinics.c2_h2": "“What medicines are you taking?” shouldn't be the hardest question of the visit.",
  "clinics.c2_body":
    "Medication information arrives as loose prescriptions, discharge summaries, photographs and memory. Piecing it together takes time the consultation doesn't have.",
  "clinics.c3_h2": "A structured list, not a shoebox of paper.",
  "clinics.c3_body":
    "Current medicines with ingredients, strengths and instructions; recorded allergies; recent changes — as the patient confirmed them. Built live at the moment of access, not a stale export. A PDF when paper is easier (English).",
  "clinics.c3_media_label": "The summary a doctor sees when a patient shares",
  "clinics.c4_h2": "No doctor account. No software to install.",
  "clinics.c4_step1": "Your patient presents a QR code or a link.",
  "clinics.c4_step2": "You open their patient-shared summary.",
  "clinics.c5_h2": "Access the patient grants — and can take away.",
  "clinics.c5_body":
    "Shares are created by the patient, last as long as the patient chooses, and the patient can stop the link at any time. Every access is recorded and visible to the patient. Stopping a link ends future access through it — it can't recall a copy already downloaded.",
  "clinics.c5_chip_patient": "Patient creates the share",
  "clinics.c5_chip_expires": "Time-limited",
  "clinics.c5_chip_revocable": "Patient can stop the link",
  "clinics.c5_chip_logged": "Every access recorded",
  "clinics.c6_h2": "Better inputs to the decisions you already make.",
  "clinics.c6_tile1": "Easier access to patient-supplied medication information.",
  "clinics.c6_tile2": "A structured, ingredient-level view.",
  "clinics.c6_tile3": "Fewer handwritten pages to interpret.",
  "clinics.c6_tile4": "Patient-controlled information exchange.",
  "clinics.c7_h2": "Bring Medicine Passport to your patients.",
  "clinics.c7_body": "Tell us who you are — we'll help you introduce Medicine Passport at your clinic or pharmacy.",

  "lead.name": "Name",
  "lead.organization": "Organization / clinic",
  "lead.role": "Role",
  "lead.role_doctor": "Doctor",
  "lead.role_pharmacist": "Pharmacist",
  "lead.role_clinic_owner": "Clinic owner",
  "lead.role_hospital_admin": "Hospital administrator",
  "lead.role_care_coordinator": "Care coordinator",
  "lead.role_other": "Other",
  "lead.role_placeholder": "Select your role",
  "lead.city": "City",
  "lead.email": "Email",
  "lead.phone": "Phone",
  "lead.contact_hint": "Enter an email or a phone number (at least one).",
  "lead.message": "Message (optional)",
  "lead.no_patient_data": "Please do not include patient or medical information.",
  "lead.consent": "I agree to be contacted by MediDocs about Medicine Passport.",
  "lead.submit": "Send",
  "lead.submitting": "Sending…",
  "lead.success_title": "Thanks — we'll be in touch.",
  "lead.success_body": "We've received your details.",
  "lead.error_generic": "Something went wrong. Please try again.",
  "lead.error_contact": "Please provide an email or a phone number.",
  "lead.error_consent": "Please agree to be contacted so we can reply.",
  "lead.error_fix_fields": "Please fix the highlighted fields and try again.",
  "lead.error_turnstile": "Please complete the verification below and try again.",
  "lead.error_rate_limited": "You've submitted a few times already. Please wait a minute and try again.",
  "lead.error_phone": "Enter a valid phone number, e.g. +1 713 555 0199.",
  "lead.error_email": "Enter a valid email address.",
  "lead.required": "required",

  "footer.privacy": "رازداری",
  "footer.terms": "شرائط",
  "footer.language": "زبان",
  "footer.english": "انگریزی",

  "media.placeholder_badge": "جھلک",

  "placeholder.privacy.title": "رازداری کی پالیسی",
  "placeholder.terms.title": "استعمال کی شرائط",
  "placeholder.legal.body": "یہ صفحہ تیار اور زیرِ جائزہ ہے۔ یہ ابھی شائع شدہ پالیسی نہیں ہے۔",

  "notfound.title": "یہ صفحہ موجود نہیں ہے۔",
  "notfound.home": "ہوم پیج پر جائیں",

  "review.banner": "مسودہ ترجمہ — زیرِ جائزہ",
};
