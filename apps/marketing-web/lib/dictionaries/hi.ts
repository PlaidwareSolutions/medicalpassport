import type { MessageKey } from "../i18n";

/**
 * Hindi marketing candidate translations (Session 13). Status: DRAFT —
 * PROFESSIONAL REVIEW REQUIRED. Not machine-published: rendered only on staging
 * draft routes (noindexed) for native-language review; never emitted by a
 * production build until reviewed + added to PUBLISHED_LOCALES.
 *
 * Rules kept: brand names "Medicine Passport"/"MediDocs" stay in Latin; demo
 * values (Glucomet 500, Metformin 500 mg, Dr. Rao) are not translated; claim
 * strength must match English exactly (no strengthening). the clinics and lead strings stay
 * English — /for-clinics/ is English-only V1 (§16), never rendered here.
 * Security/sharing + trust "does not" strings need extra review scrutiny.
 */
export const hi: Record<MessageKey, string> = {
  "brand.name": "Medicine Passport",
  "brand.endorsement": "MediDocs द्वारा",
  "brand.company_line": "MediDocs",

  "nav.help": "मदद",
  "nav.for_clinics": "डॉक्टरों और क्लिनिक के लिए",
  "nav.skip": "मुख्य सामग्री पर जाएँ",

  "header.cta": "मेरा मुफ़्त Medicine Passport बनाएँ",
  "header.cta_short": "मुफ़्त शुरू करें",

  "hero.h1": "आपकी दवाएँ। एक जगह। आपकी भाषा में।",
  "hero.sub":
    "आप क्या लेते हैं, क्यों लेते हैं, कब लेते हैं, और डॉक्टर को क्या दिखाना है — जहाँ भी जाएँ, सब याद रखें।",
  "hero.chip_free": "सभी मरीज़ों के लिए मुफ़्त",
  "hero.chip_no_install": "कोई ऐप इंस्टॉल नहीं करना",
  "hero.chip_languages": "ऐप की भाषाएँ: English · हिंदी · తెలుగు · اردو",
  "hero.cta": "मेरा मुफ़्त Medicine Passport बनाएँ",
  "hero.secondary": "देखें यह कैसे काम करता है",
  "hero.media_label": "उत्पाद का प्रदर्शन",
  "hero.media_note": "असली ऐप का वीडियो मीडिया तैयार होने पर आएगा।",

  "problem.h2": "यह जाना-पहचाना लगता है?",
  "problem.a_title": "“आप कौन-सी दवाएँ ले रहे हैं?”",
  "problem.a_body":
    "जब आपकी कहानी का हर हिस्सा अलग-अलग डॉक्टर के पास हो, तो एक आसान सवाल भी मुश्किल हो जाता है। दराज़ में दवा के पत्ते, फ़ोल्डर में पर्चे, फ़ोन में फ़ोटो — और डॉक्टर जवाब का इंतज़ार करते हुए।",
  "problem.b_title": "दो नाम, एक ही घटक",
  "problem.b_body":
    "डॉक्टर A एक ब्रांड लिखते हैं। डॉक्टर B दूसरा। दो अलग ब्रांड नामों में एक ही घटक हो सकता है — और परिवार के लिए यह जानना आसान नहीं होता।",
  "problem.c_title": "दूसरे शहर से देखभाल",
  "problem.c_body":
    "आपके पिता की दवाएँ विजयवाड़ा में हैं। आप बेंगलुरु में हैं। पिछली बार क्या बदला, इसकी याद ही अकेला रिकॉर्ड है।",
  "problem.thesis":
    "आपकी दवा की जानकारी आपके साथ चलनी चाहिए — पर्चों, डॉक्टरों, दवा दुकानों और अस्पताल की फ़ाइलों में बिखरी नहीं रहनी चाहिए।",
  "problem.reveal": "Medicine Passport इसीलिए है।",

  "reveal.h2": "एक दवा रिकॉर्ड, जो मरीज़ का अपना है।",
  "reveal.body":
    "हर दवा, उन ज़रूरी बातों के साथ: नाम, घटक, ताक़त, कब और कैसे लेनी है, किस डॉक्टर ने लिखी, और क्यों — आसान शब्दों में। यह आपका रिकॉर्ड है। यह आपके साथ जाता है।",
  "reveal.card_caption": "सिर्फ़ उदाहरण — यह असली स्क्रीन नहीं है।",
  "reveal.f_name": "दवा",
  "reveal.f_name_v": "Glucomet 500",
  "reveal.f_ingredient": "घटक",
  "reveal.f_ingredient_v": "Metformin 500 mg",
  "reveal.f_schedule": "कब",
  "reveal.f_schedule_v": "सुबह और रात, खाने के बाद",
  "reveal.f_doctor": "किसने लिखी",
  "reveal.f_doctor_v": "Dr. Rao",
  "reveal.f_reason": "आपका दर्ज किया कारण",
  "reveal.f_reason_v": "ब्लड शुगर",
  "reveal.f_status": "स्थिति",
  "reveal.f_status_v": "अभी चल रही",

  "know.h2": "जानें आप क्या ले रहे हैं।",
  "know.body":
    "अपनी दवाएँ अपने तरीके से जोड़ें: पर्चे की फ़ोटो लें और Medicine Passport जो पढ़े उसे जाँचें — सहेजने से पहले हर बात आप ख़ुद देखते हैं। या खोज कर दवा ढूँढें, या ख़ुद टाइप करें। पर्चों की फ़ोटो और रिपोर्ट आपके रिकॉर्ड के साथ जुड़ी रहती हैं।",
  "know.chip_photo": "फ़ोटो",
  "know.chip_search": "खोज",
  "know.chip_manual": "ख़ुद टाइप करें",
  "know.media_label": "पर्चे की फ़ोटो से दवा जोड़ना",

  "remember.h2": "जानें आगे क्या है।",
  "remember.body":
    "आज की दवाएँ एक टाइमलाइन पर देखें। खुराक को लिया, छोड़ा या टाला के रूप में दर्ज करें। चाहें तो ब्राउज़र रिमाइंडर चालू करें, और जानें कब दवा कम हो रही है। Medicine Passport आज की दवाओं को सामने और व्यवस्थित रखने में मदद करता है।",
  "remember.chip_timeline": "आज की टाइमलाइन",
  "remember.chip_reminders": "वैकल्पिक रिमाइंडर",
  "remember.chip_refills": "दवा कम होने की जानकारी",
  "remember.media_label": "आज की टाइमलाइन और खुराक दर्ज करना",

  "access.h2": "सेहत की जानकारी के लिए बढ़िया अंग्रेज़ी, बढ़िया नज़र या नया फ़ोन ज़रूरी नहीं होना चाहिए।",
  "access.sub": "पढ़ें — या सुनें।",
  "access.body":
    "Medicine Passport ऐप English, हिंदी, తెలుగు और اردو बोलता है — जिसमें दाएँ-से-बाएँ लिखी जाने वाली उर्दू भी शामिल है। ऐप में दी गई मार्गदर्शन जानकारी को Listen बटन दबाकर सुना जा सकता है। बड़े अक्षर, बड़े बटन, आसान स्क्रीन — असली फ़ोन और असली नेटवर्क के लिए बने।",
  "access.lang_en": "English",
  "access.lang_hi": "हिंदी",
  "access.lang_te": "తెలుగు",
  "access.lang_ur": "اردو",
  "access.listen": "सुनें",
  "access.media_label": "वही स्क्रीन चार भाषाओं में",
  "access.video_label": "ऐप में पढ़कर सुनाना: Listen दबाना, मार्गदर्शन चलना, फिर Stop",
  "access.audio_cta": "सुनें Medicine Passport कैसा लगता है",
  "access.audio_stop": "रोकें",
  "access.audio_error": "अभी ऑडियो उपलब्ध नहीं है",
  "access.audio_note": "ऐप की असली मार्गदर्शन आवाज़ (English)। बटन दबाने पर ही चलती है।",

  "offline.h2": "नेटवर्क जाने पर आपका दवा रिकॉर्ड गायब नहीं होना चाहिए।",
  "offline.body":
    "आपकी सहेजी दवाएँ बिना इंटरनेट भी दिखती हैं। खुराक ऑफ़लाइन दर्ज करें — नेटवर्क आने पर वे सिंक हो जाती हैं। आप हमेशा देख सकते हैं कि आप ऑफ़लाइन हैं, सिंक हो रहा है, या अपडेट हैं।",
  "offline.honest": "रिमाइंडर के लिए कनेक्शन ज़रूरी है।",
  "offline.media_label": "ऑफ़लाइन देखना और खुराक दर्ज करना, फिर सिंक",

  "care.h2": "अपने माता-पिता की मदद करें, उनका नियंत्रण छीने बिना।",
  "care.body":
    "परिवार को मदद के लिए बुलाएँ — और तय करें कि हर व्यक्ति क्या देख या कर सकता है। कहीं से भी माता-पिता या आश्रित की दवाएँ सँभालें। हर देखभालकर्ता की पहुँच मरीज़ को दिखती है, और पहुँच कभी भी हटाई जा सकती है।",
  "care.tagline": "ऐसी मदद जो दी जाती है, सीमित है, दिखती है — और हटाई जा सकती है।",
  "care.cta": "अपने परिवार के लिए Medicine Passport बनाएँ",
  "care.media_label": "देखभालकर्ता को बुलाना और अनुमतियाँ चुनना",

  "share.h2": "अपॉइंटमेंट पर काग़ज़ का फ़ोल्डर नहीं — अपनी दवा सूची लाएँ।",
  "share.body":
    "QR कोड या लिंक से एक शेयर बनाएँ, जो जितनी देर आप चाहें उतना चले। डॉक्टर अपने ही डिवाइस पर एक व्यवस्थित सारांश खोलते हैं — न MediDocs अकाउंट, न कुछ इंस्टॉल करना। आप लिंक को कभी भी बंद कर सकते हैं, और देख सकते हैं कि वह कब खोला गया।",
  "share.chip_qr": "QR या लिंक",
  "share.chip_expires": "कितनी देर चले, आप तय करें",
  "share.chip_no_account": "डॉक्टर का अकाउंट नहीं चाहिए",
  "share.chip_revocable": "लिंक कभी भी बंद करें",
  "share.media_label": "शेयर बनाना, और डॉक्टर को दिखने वाला सारांश",

  "bridge.h2": "क्या आप डॉक्टर, फ़ार्मासिस्ट या क्लिनिक हैं?",
  "bridge.body":
    "देखें कि मरीज़ के पास रहने वाला Medicine Passport, जब मरीज़ साझा करना चुने, तो दवा की जानकारी देखना कैसे आसान बना सकता है।",
  "bridge.cta": "स्वास्थ्य पेशेवरों के लिए Medicine Passport",

  "free.h2": "Medicine Passport सभी मरीज़ों के लिए मुफ़्त है।",
  "free.body":
    "आपकी दवा की जानकारी आपकी अपनी है। Medicine Passport सभी मरीज़ों के लिए बनाने, बनाए रखने और देखने के लिए मुफ़्त है। हम MediDocs को स्वास्थ्य संस्थाओं के साथ सेवाओं और साझेदारियों से चलाने की योजना रखते हैं — मरीज़ों से उनकी अपनी दवा जानकारी देखने का शुल्क लेकर नहीं।",
  "free.chip_no_ads": "मरीज़ के अनुभव में कोई विज्ञापन नहीं",
  "free.chip_no_paywall": "अपने रिकॉर्ड पर कोई शुल्क-दीवार नहीं",

  "trust.h2": "आपकी दवाओं को समझने में मदद के लिए बना — आपके डॉक्टर की जगह लेने के लिए नहीं।",
  "trust.does_h3": "Medicine Passport यह करता है",
  "trust.does_1": "आपकी दवा जानकारी को व्यवस्थित रखता है — और आपकी अपनी।",
  "trust.does_2": "आज की खुराक एक टाइमलाइन पर दिखाता है, वैकल्पिक ब्राउज़र रिमाइंडर के साथ।",
  "trust.does_3": "देखने और दर्ज करने के लिए ऑफ़लाइन काम करता है, नेटवर्क आने पर सिंक करता है।",
  "trust.does_4": "आपकी दी गई, दिखने वाली और हटाई जा सकने वाली अनुमतियों से परिवार को मदद करने देता है।",
  "trust.not_h3": "Medicine Passport यह नहीं करता",
  "trust.not_1": "यह न रोग पहचानता है, न दवा लिखता है।",
  "trust.not_2": "यह आपको दवा शुरू या बंद करने को नहीं कहता।",
  "trust.not_3": "यह एक दवा की जगह दूसरी नहीं सुझाता।",
  "trust.not_4": "यह किसी दवा को “सुरक्षित” घोषित नहीं करता।",
  "trust.not_5": "यह डॉक्टरों या फ़ार्मासिस्टों की जगह नहीं लेता।",

  "faq.h2": "वे सवाल जो परिवार सचमुच पूछते हैं।",
  "faq.q1": "क्या Medicine Passport सचमुच मुफ़्त है?",
  "faq.a1":
    "हाँ — सभी मरीज़ों के लिए बनाने, बनाए रखने और देखने के लिए मुफ़्त। हम MediDocs को स्वास्थ्य संस्थाओं के साथ सेवाओं और साझेदारियों से चलाने की योजना रखते हैं, मरीज़ों से शुल्क लेकर नहीं।",
  "faq.q2": "क्या मुझे कोई ऐप इंस्टॉल करना होगा?",
  "faq.a2":
    "नहीं। Medicine Passport आपके फ़ोन के ब्राउज़र में चलता है। चाहें तो इसे होम स्क्रीन पर जोड़ सकते हैं, पर यह ज़रूरी नहीं।",
  "faq.q3": "ऐप किन भाषाओं में उपलब्ध है?",
  "faq.a3":
    "ऐप English, हिंदी, తెలుగు और اردو में उपलब्ध है। यह वेबसाइट अभी English में है; अनुवाद समीक्षा के बाद और भाषाएँ आएँगी।",
  "faq.q4": "क्या मेरा परिवार मेरी दवाएँ सँभालने में मदद कर सकता है?",
  "faq.a4":
    "हाँ। किसी परिवार के सदस्य को बुलाएँ और तय करें कि वे क्या देख या कर सकते हैं। आप उनकी हर पहुँच देख सकते हैं, और पहुँच कभी भी हटा सकते हैं।",
  "faq.q6": "क्या यह बता सकता है कि दो दवाएँ साथ लेना सुरक्षित है?",
  "faq.a6":
    "नहीं। Medicine Passport दवाओं के आपसी असर की जाँच नहीं करता और किसी मेल को कभी सुरक्षित घोषित नहीं करता। दवाएँ साथ लेने के सवाल आपके डॉक्टर या फ़ार्मासिस्ट के हैं।",
  "faq.q7": "क्या Medicine Passport चिकित्सा सलाह की जगह लेता है?",
  "faq.a7":
    "नहीं। यह आपकी अपनी दवा जानकारी रखने और समझने में मदद करता है। आपकी दवाओं के फ़ैसले हमेशा आपके डॉक्टर या फ़ार्मासिस्ट के होते हैं।",
  "faq.q8": "अगर मेरे पास इंटरनेट न हो तो क्या होगा?",
  "faq.a8":
    "आपकी सहेजी दवाएँ दिखती रहती हैं, और आप खुराक ऑफ़लाइन दर्ज कर सकते हैं — नेटवर्क आने पर सब सिंक हो जाता है। रिमाइंडर के लिए कनेक्शन ज़रूरी है।",
  "faq.q9": "मेरी जानकारी कौन देख सकता है?",
  "faq.a9":
    "आपका Medicine Passport सार्वजनिक रूप से सूचीबद्ध नहीं है। परिवार के देखभालकर्ताओं को केवल वही पहुँच मिलती है जो आप देते हैं, और वह पहुँच आप कभी भी हटा सकते हैं।",
  "faq.q10": "क्या मैं किसी परिवार सदस्य की पहुँच हटा सकता हूँ?",
  "faq.a10":
    "हाँ, कभी भी। देखभालकर्ता की पहुँच आप देते हैं, आपको दिखती है, और आप ही हटा सकते हैं।",

  "final.h2": "अपनी दवा जानकारी अपने साथ ले जाएँ।",
  "final.sub": "आज ही अपना Medicine Passport शुरू करें।",
  "final.qr": "फ़ोन पर खोलने के लिए स्कैन करें",

  // /for-clinics/ (C1–C7) + lead form stay ENGLISH — English-only V1 (§16),
  // never rendered on a translated route.
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

  "footer.privacy": "गोपनीयता",
  "footer.terms": "शर्तें",
  "footer.language": "भाषा",
  "footer.english": "अंग्रेज़ी",

  "media.placeholder_badge": "झलक",

  "placeholder.privacy.title": "गोपनीयता नीति",
  "placeholder.terms.title": "उपयोग की शर्तें",
  "placeholder.legal.body": "यह पृष्ठ तैयार और समीक्षा के अधीन है। यह अभी प्रकाशित नीति नहीं है।",

  "notfound.title": "यह पृष्ठ मौजूद नहीं है।",
  "notfound.home": "होम पेज पर जाएँ",

  "review.banner": "मसौदा अनुवाद — समीक्षा के अधीन",
};
