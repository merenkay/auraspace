// Symptom and exposure vocabulary for the offline consultation. Free text is matched against
// English and Turkish synonyms (written in "folded" form: lower case, Turkish letters mapped to ASCII).
export type FindingKind = 'symptom' | 'exposure'
export type FindingGroup = 'chest' | 'breathing' | 'head' | 'stomach' | 'skin' | 'body' | 'mood' | 'urine' | 'event'

export type FindingDef = {
  id: string
  label: string
  question: string
  kind: FindingKind
  group: FindingGroup
  /** Regular-expression sources matched on folded text. */
  match: string[]
}

const f = (id: string, label: string, question: string, group: FindingGroup, match: string[], kind: FindingKind = 'symptom'): FindingDef => ({ id, label, question, kind, group, match })

export const FINDINGS: FindingDef[] = [
  // chest and circulation
  f('chest-pain', 'Chest pain, pressure or tightness', 'Do you have pain, pressure, tightness or a squeezing feeling in your chest?', 'chest', [
    'chest\\w* (?:pain|hurt|ache|tight|pressure|discomfort|squeez)', '(?:pain|ache|tightness|pressure|discomfort|crushing|squeezing)\\w* (?:in|on|across) (?:my |the )?chest', 'chest hurts?', 'tight chest',
    'gogu?s\\w* (?:agri|sikis|bask|yan|daral)', 'gogsum\\w* (?:agri|sikis|yan)', 'gogsumde', 'gogus agrisi',
  ]),
  f('pain-spread', 'Pain or numbness spreading to an arm, the jaw, neck or back', 'Does the pain or a numb feeling spread to your arm, jaw, neck or back?', 'chest', [
    '(?:left|right|both)? ?arms?\\b[^.,;]{0,24}(?:numb|hurt|pain|ach|tingl|heavy)', '(?:numb|pain|ache|tingl)\\w*[^.,;]{0,20}(?:arm|jaw|neck|shoulder)', '\\bjaw\\b', 'spread\\w* to (?:my |the )?(?:arm|jaw|neck|back)',
    '(?:sol|sag)? ?kol\\w* (?:uyus|agri|kar|sizl)', 'cene\\w* (?:agri|uyus)', 'boyn\\w* (?:agri|uyus)', '(?:kol|cene|boyun)\\w*a vur',
  ]),
  f('palpitations', 'Racing or pounding heartbeat', 'Is your heart racing, pounding or beating irregularly?', 'chest', ['palpitat', 'heart (?:is )?(?:racing|pounding|fluttering|beating fast)', 'racing heart', 'carpinti', 'kalbim\\w* (?:hizli|cok hizli|carp)']),
  f('lightheaded', 'Light-headed, dizzy or faint', 'Do you feel light-headed, dizzy or as if you might faint?', 'head', ['light ?headed', 'dizz', 'faint\\b', 'about to pass out', 'bas\\w* don', 'basim donuyor', 'bayilacak gibi', 'sersem']),
  f('collapse', 'Fainted, collapsed or hard to wake', 'Has anyone fainted, collapsed, or become hard to wake?', 'head', ['collaps', 'passed out', 'unconscious', 'fainted', 'not responding', 'unresponsive', 'bayildi', 'bayildim', 'bilinc\\w* kayb', 'uyandiramiyor']),
  f('pale-blue-skin', 'Pale, blue, grey or blotchy skin or lips', 'Are your lips or skin pale, blue, grey or blotchy?', 'skin', ['(?:lips|skin|face)\\w*[^.,;]{0,15}(?:blue|grey|gray|pale|blotchy|mottled)', '(?:blue|grey|gray|pale|blotchy|mottled) (?:lips|skin)', 'moraran', 'dudak\\w* mor', 'solgun', 'benzim atti', 'cilt\\w* alaca']),

  // breathing
  f('breathless', 'Shortness of breath', 'Are you short of breath or struggling to breathe?', 'breathing', ['short(?:ness)? of breath', 'breathless', "(?:can't|cannot|cant|hard to|struggling to|trouble) breath", 'difficulty breathing', 'out of breath', 'nefes\\w* (?:darl|alamiyor|alam|yetmiyor|zorl|kesil)', 'soluk\\w* (?:alamiyor|daral)']),
  f('wheeze', 'Wheezing', 'Is there a whistling or wheezing sound when you breathe?', 'breathing', ['wheez', 'whistl\\w* (?:when|sound)', 'hiriltil?', 'hisilti', 'hirilti']),
  f('fast-breathing', 'Breathing very fast', 'Are you breathing much faster than normal?', 'breathing', ['breath\\w* (?:very )?fast', 'rapid breath', 'hyperventilat', 'hizli nefes', 'hizli hizli nefes', 'solugum hizlandi']),
  f('cough', 'Cough', 'Do you have a cough?', 'breathing', ['cough', 'oksur']),
  f('throat-swelling', 'Swollen lips, tongue or throat, or trouble swallowing', 'Are your lips, tongue or throat swelling, or is it hard to swallow?', 'breathing', ['(?:throat|tongue|lips?|mouth)\\w*[^.,;]{0,15}(?:swell|swollen|tight|closing)', 'swollen (?:throat|tongue|lips?)', 'hard to swallow', "can't swallow", 'bogaz\\w* (?:sis|daral|kapan)', 'dil\\w* sis', 'dudak\\w* sis', 'yutkunam', 'yutam']),

  // head and nervous system
  f('face-droop', 'Face drooping on one side', 'Has one side of the face dropped, or is it hard to smile evenly?', 'head', ['face\\w*[^.,;]{0,15}(?:droop|drop|fall|uneven)', 'droop\\w* (?:face|mouth)', "(?:can't|cannot) smile", 'mouth\\w*[^.,;]{0,10}droop', '(?:yuz|agz|agiz)\\w* (?:kay|sark|egil|dus)', 'yuzum kaydi', 'agzim kaydi']),
  f('one-side-weak', 'Weakness in one arm or leg (cannot lift and hold both arms up)', 'Can you lift both arms and keep them up? Is one arm or leg weak or numb?', 'head', ['weak\\w*[^.,;]{0,15}(?:one side|arm|leg)', "(?:can't|cannot|unable to) (?:lift|raise|move) (?:my |one |the )?(?:arm|leg)", 'one side of (?:my|the) body', 'arm (?:is )?weak', 'leg (?:is )?weak', 'kol\\w* kaldiram', 'bacag\\w* (?:tutmuyor|kaldiram)', 'tek taraf', 'bir taraf\\w* (?:uyus|gucsuz|tutmuyor)', 'gucsuzlu']),
  f('speech', 'Slurred or confused speech', 'Is speech slurred, garbled, or hard to understand?', 'head', ['slur', 'garbled', "(?:can't|cannot|trouble|hard to) (?:speak|talk|get words)", 'speech', 'peltek', 'konusma\\w* (?:bozul|zorl|anlasilmaz|bulan)', 'konusamiyor', 'kelime\\w* bulam']),
  f('vision-loss', 'Sudden loss or blurring of vision', 'Have you suddenly lost vision or got blurred vision in one or both eyes?', 'head', ['(?:lost|loss of|losing) (?:my )?(?:vision|sight)', 'sudden\\w* blur', "(?:can't|cannot) see", 'double vision', 'gorme\\w* kayb', 'ani bulanik', 'cift gor', 'goremiyorum']),
  f('severe-headache', 'Sudden, very severe headache', 'Did a very severe headache come on suddenly — the worst you have had?', 'head', ['(?:sudden|severe|worst|thunderclap)[^.,;]{0,12}headache', 'worst headache', 'cok siddetli bas agri', 'siddetli bas agrisi', 'ani bas agrisi']),
  f('headache', 'Headache', 'Do you have a headache?', 'head', ['headache', 'head (?:hurts|aches|is pounding)', 'bas\\w* agri', 'basim agriyor']),
  f('confusion', 'Confusion or not making sense', 'Is there new confusion, odd behaviour, or not making sense?', 'head', ['confus', 'disorient', 'not making sense', "don't know where", 'bilinc\\w* bulan', 'kafa\\w* karis', 'saskin', 'nerede oldug']),
  f('drowsy', 'Very sleepy, slow or hard to keep awake', 'Is there unusual drowsiness or difficulty staying awake?', 'head', ['drows', 'very sleepy', 'hard to stay awake', 'lethargic', 'uyusuk', 'uyku hali', 'uyuklu']),
  f('poor-balance', 'Clumsy or unsteady walking', 'Is walking unsteady or are movements clumsy?', 'head', ['unsteady', 'clumsy', 'loss of balance', 'losing (?:my )?balance', "can't walk straight", 'denge\\w* (?:kayb|bozuk|sorun)', 'sendel']),
  f('spinning', 'Spinning feeling or disorientation', 'Do you feel the room spinning or lose track of up and down?', 'head', ['spinning', 'vertigo', 'room is spinning', 'upside down', 'oda donuyor', 'yon\\w* kaybed', 'vertigo']),
  f('tingling', 'Tingling fingers or lips', 'Do you have pins and needles or tingling in your fingers or around your lips?', 'skin', ['tingl', 'pins and needles', 'karincalan']),
  f('trembling', 'Shaking or trembling', 'Are you shaking or trembling?', 'body', ['trembl', 'shaky', 'shaking', 'titriyor', 'titreme', 'el\\w* titr']),
  f('sweating', 'Sweating or a cold sweat', 'Are you sweating or in a cold sweat?', 'skin', ['sweat', 'clammy', 'terle', 'soguk ter', 'terliyorum']),
  f('fear', 'Sudden intense fear or panic', 'Did a wave of intense fear or panic come on suddenly?', 'mood', ['panic', 'terrified', 'sense of doom', 'going to die', 'intense fear', 'panik', 'olecek gibi', 'korku\\w*']),

  // stomach, metabolism
  f('nausea', 'Feeling sick (nausea)', 'Do you feel sick (nauseous)?', 'stomach', ['nause', 'feel(?:ing)? sick', 'queasy', 'bulanti', 'midem bulan']),
  f('vomiting', 'Being sick (vomiting)', 'Have you been sick (vomited)?', 'stomach', ['vomit', 'throwing up', 'threw up', 'been sick', 'kus(?:tum|uyor|ma)']),
  f('hunger', 'Sudden hunger', 'Do you feel suddenly very hungry?', 'stomach', ['hungry', 'hunger', 'acik(?:tim|tim)', 'cok ac']),
  f('thirst', 'Very thirsty or dry mouth', 'Are you very thirsty, or is your mouth dry?', 'stomach', ['thirst', 'dry mouth', 'susa', 'agiz\\w* kuru', 'agzim kuru']),
  f('dark-urine', 'Dark urine or peeing less than usual', 'Is your urine dark, or are you peeing less than usual?', 'urine', ['dark (?:urine|pee)', 'peeing less', 'not peeing much', 'koyu idrar', 'idrar\\w* (?:az|koyu)']),
  f('cramps', 'Muscle cramps', 'Do you have muscle cramps?', 'body', ['cramp', 'kramp', 'kasil']),
  f('fatigue', 'Unusual tiredness or exhaustion', 'Do you feel unusually tired or exhausted?', 'body', ['tired', 'exhaust', 'fatigue', 'no energy', 'worn out', 'yorgun', 'halsiz', 'bitkin']),
  f('aches', 'Aching body or muscles', 'Do your muscles or body ache?', 'body', ['aching', 'body aches', 'muscle aches', 'achy', 'kas agri', 'vucud\\w* agri', 'her yerim agri']),

  // infection, temperature
  f('fever', 'High temperature or feeling hot and shivery', 'Do you have a high temperature, or feel hot and shivery?', 'body', ['fever', 'high temperature', 'temperature is high', 'feverish', '\\bates']),
  f('chills', 'Shivering or feeling very cold', 'Are you shivering or feeling very cold?', 'body', ['shiver', 'chills', 'freezing', 'very cold', 'usu(?:yor|me|dum)', 'titre(?:me|iyor) ?(?:soguk)?', 'donuyorum']),
  f('infection', 'A known or suspected infection', 'Do you have signs of an infection — for example a chest, urine or wound infection?', 'body', ['infection', 'infected', 'wound', '\\buti\\b', 'enfeksiyon', 'iltihap', '\\byara\\b']),
  f('hot-skin-no-sweat', 'Very hot skin that has stopped sweating', 'Is the skin very hot but not sweating?', 'skin', ['hot (?:and )?dry skin', 'not sweating', 'stopped sweating', 'skin is (?:very )?hot', 'terlemiyor', 'cilt\\w* (?:cok )?sicak']),
  f('rash', 'Itchy rash or hives', 'Is there an itchy rash, raised bumps or hives on the skin?', 'skin', ['rash', 'hives', 'itchy', 'welts', 'kurdesen', 'kasinti', 'dokuntu']),

  // cold, altitude
  f('numb-cold-skin', 'Numb, cold, white or grey fingers, toes, nose or ears', 'Are fingers, toes, nose or ears numb, cold, white or grey?', 'skin', ['(?:fingers|toes|nose|ears?|feet|hands)\\w*[^.,;]{0,15}(?:numb|white|grey|gray|frozen|cold)', 'frostnip', 'parmak\\w* (?:uyus|dondu|bem|soguk)', 'kulak\\w* dondu', 'burn\\w* dondu']),
  f('blisters-hard-skin', 'Hard, frozen skin or blisters after cold', 'Is the skin hard and frozen, swollen without feeling, or blistered after cold?', 'skin', ['blister', 'hard (?:and )?(?:frozen|white) skin', 'skin (?:is )?(?:hard|frozen|black)', 'frostbit', 'kabarc', 'su toplad', 'donma']),

  // pain in specific places
  f('back-pain', 'Back pain', 'Do you have back pain?', 'body', ['back (?:pain|hurts|ache)', 'backache', 'lower back', 'bel\\w* agri', 'sirt\\w* agri', 'belim agriyor']),
  f('saddle-numb', 'Numbness around the bottom or genitals, or loss of bladder or bowel control', 'Is there numbness around your bottom or genitals, weakness in both legs, or loss of bladder or bowel control?', 'urine', ['numb\\w*[^.,;]{0,15}(?:bottom|genital|groin|saddle)', 'loss of bladder', 'wet myself', 'incontinen', 'idrar kacir', 'kasik\\w* uyus', 'cinsel bolge\\w* uyus']),
  f('flank-pain', 'Severe pain in the side or back that may spread to the groin', 'Is there severe pain in your side or lower back, possibly spreading to the groin?', 'urine', ['(?:side|flank|kidney)[^.,;]{0,10}(?:pain|hurt)', 'pain in (?:my )?(?:side|flank)', 'to (?:my |the )?groin', 'bogur\\w* agri', 'yan\\w* agri', 'bobrek\\w* agri', 'kasig\\w* vur']),
  f('blood-urine', 'Blood in urine', 'Is there blood in your urine (pink, red or brown pee)?', 'urine', ['blood in (?:my )?(?:urine|pee)', '(?:red|pink|brown) (?:urine|pee)', 'idrar\\w* kan', 'kanli idrar']),
  f('painful-urination', 'Pain or burning when peeing', 'Does it hurt or burn when you pee?', 'urine', ['burn\\w* when (?:i )?(?:pee|urinat)', 'pain(?:ful)? (?:when )?(?:peeing|urinat)', 'idrar\\w* yan', 'yanma\\w* idrar']),
  f('cant-urinate', 'Cannot pee or bladder feels full', 'Are you unable to pee even though your bladder feels full?', 'urine', ["(?:can't|cannot|unable to) (?:pee|urinate)", 'idrar yapamiyorum', 'idrar\\w* yapam']),
  f('joint-pain', 'Joint pain (shoulder, elbow, knee)', 'Do you have deep pain in a joint such as a shoulder, elbow or knee?', 'body', ['joint\\w* (?:pain|hurt|ache)', '(?:shoulder|elbow|knee|wrist)\\w* (?:pain|hurt|ache)', 'eklem\\w* agri', 'omuz\\w* agri', 'dirsek\\w* agri', 'diz\\w* agri']),
  f('limb-pain-swelling', 'Pain, swelling or an odd shape in an arm, leg or hip', 'Is there pain, swelling, bruising or an odd shape in an arm, leg or hip?', 'body', ['(?:hip|leg|wrist|ankle)\\w*[^.,;]{0,15}(?:pain|hurt|swell|swollen|bruis|deform)', 'swollen (?:leg|arm|ankle|wrist)', 'kalca\\w* agri', 'bacag\\w* (?:agri|sis)', 'bilek\\w* (?:agri|sis)', 'morarma', 'sislik']),
  f('cant-bear-weight', 'Cannot get up, stand, or put weight on a leg', 'Are you unable to get up, stand, or put weight on one leg?', 'body', ["(?:can't|cannot|unable to) (?:get up|stand|walk|put weight)", 'kalkamiyorum', 'ayaga kalkam', 'basamiyorum', 'yuruyemiyorum']),

  // vision (spaceflight)
  f('near-vision-blur', 'Gradual blurring of near vision', 'Has close-up vision (reading, checklists) slowly become blurrier?', 'head', ['(?:near|close|reading)[^.,;]{0,12}blur', 'blur\\w*[^.,;]{0,12}(?:near|close|read)', "(?:can't|cannot) read (?:the )?(?:checklist|small)", 'yakin\\w* (?:gor|bulan)', 'okurken bulan']),

  // mood and sleep
  f('low-mood', 'Low mood, sadness or loss of interest', 'Have you been feeling low, sad, hopeless or lost interest in things?', 'mood', ['low mood', 'depress', 'sad\\b', 'hopeless', 'feel(?:ing)? down', 'lost interest', 'mutsuz', 'keyifsiz', 'umutsuz', 'cokkun', 'moralim bozuk', 'depresif']),
  f('irritable', 'Irritable or on edge', 'Have you been unusually irritable, tense or on edge?', 'mood', ['irritab', 'on edge', 'short[- ]tempered', 'snapping at', 'sinirli', 'gergin', 'tahammul']),
  f('self-harm', 'Thoughts of harming yourself or that life is not worth living', 'Have you had thoughts of harming yourself, or that life is not worth living?', 'mood', ['self[- ]harm', 'harm myself', 'kill myself', 'suicid', 'end my life', 'not worth living', 'kendime zarar', 'intihar', 'yasamak istemiyorum', 'olmek istiyorum']),
  f('insomnia', 'Trouble falling or staying asleep', 'Do you have trouble falling asleep, staying asleep, or waking too early?', 'mood', ["(?:can't|cannot|trouble|hard to|difficulty) (?:sleep|fall(?:ing)? asleep|stay(?:ing)? asleep)", 'insomnia', 'not sleeping', 'waking up (?:early|at night)', 'uykusuz', 'uyuyamiyorum', 'uyku sorun', 'gece uyan']),

  // exposures and events (asked as yes/no context questions)
  f('allergen', 'Contact with something you are allergic to', 'Have you just eaten, touched, taken or been stung by something you are (or might be) allergic to?', 'event', ['allerg', 'stung', 'bee sting', 'wasp', 'peanut', '\\bnuts?\\b', 'alerji', 'ari sokt', 'fistik'], 'exposure'),
  f('diabetes-meds', 'Takes insulin or diabetes tablets', 'Do you take insulin or tablets for diabetes?', 'event', ['diabet', 'insulin', 'seker hasta', 'diyabet', 'insulin'], 'exposure'),
  f('missed-meal', 'Missed or delayed a meal, or more activity than usual', 'Have you missed or delayed a meal, or been more active than usual?', 'event', ['missed (?:a |my )?(?:meal|lunch|breakfast|dinner)', "haven't eaten", 'skipped (?:a )?meal', 'not eaten', 'ogun atla', 'yemek yemedim', 'ac kaldim'], 'exposure'),
  f('heat-exposure', 'In a hot place or exercising hard in the heat', 'Have you been in a hot place or exercising hard in the heat?', 'event', ['heat ?wave', 'hot (?:day|weather|room|sun)', 'in the sun', 'sicak\\w* (?:hava|oda|gun)', 'gunes\\w* altinda', 'sicak carp'], 'exposure'),
  f('cold-exposure', 'Out in the cold, wind or wet', 'Have you been out in the cold, wind or wet — or in a cold home?', 'event', ['(?:in|out in) the cold', 'freezing (?:outside|weather)', 'cold (?:home|room|house|weather|water)', 'blizzard', 'wet clothes', 'soguk\\w* (?:hava|ev|disari)', 'kar\\w* ?(?:firtina)', 'islak kiyafet'], 'exposure'),
  f('recent-ascent', 'Recently arrived at or climbed to high altitude', 'Have you recently arrived at, or climbed to, a high altitude (above about 2,500 m)?', 'event', ['altitude', 'high up', 'climb\\w*', 'mountain', 'dome c', 'concordia', 'yukseklik', 'rakim', 'tirman'], 'exposure'),
  f('fuel-appliance', 'A heater, stove, boiler, generator or engine running nearby', 'Is there a fuel-burning heater, stove, boiler, generator or engine running in or near the room?', 'event', ['heater', 'stove', 'boiler', 'generator', 'engine running', 'fireplace', 'gas fire', 'soba', 'kombi', 'jenerator', 'mangal', 'sofben'], 'exposure'),
  f('others-same', 'Other people nearby have similar symptoms', 'Do other people (or pets) in the same place have similar symptoms?', 'event', ['others (?:have|feel)', 'everyone (?:has|feels)', 'my (?:partner|family|crewmates?) (?:also|too)', 'herkes\\w*', 'digerleri de'], 'exposure'),
  f('better-away', 'Feels better away from that room or building', 'Do the symptoms ease when you leave that room or building?', 'event', ['better (?:outside|when i leave|away)', 'disarida (?:iyi|gec)', 'disari cikinca'], 'exposure'),
  f('dark-season', 'Long dark winter or polar night', 'Is it the dark season (winter or polar night) where you are?', 'event', ['polar night', 'dark (?:season|winter)', 'no (?:sun|daylight)', 'winter', 'kis\\b', 'karanlik', 'gunes yok', 'kutup gece'], 'exposure'),
  f('first-days', 'In the first days of weightlessness or a new environment', 'Are you in the first few days of the mission (or just arrived in weightlessness)?', 'event', ['first (?:few )?days', 'just (?:arrived|launched|docked)', 'since launch', 'ilk gun', 'yeni geldim'], 'exposure'),
  f('recent-eva', 'A spacewalk or pressure change in the last 24 hours', 'Have you done a spacewalk (EVA) or had a cabin pressure change in the last 24 hours?', 'event', ['\\beva\\b', 'spacewalk', 'space walk', 'suit run', 'depressuri[sz]', 'uzay yuruy'], 'exposure'),
  f('co2-alarm', 'High cabin CO₂ or poor airflow where you were', 'Was the cabin CO₂ reading high, or were you in a spot with poor airflow?', 'event', ['co2', 'carbon dioxide', 'stuffy', 'poor (?:airflow|ventilation)', 'stale air', 'karbondioksit', 'havasiz'], 'exposure'),
  f('fall', 'Had a fall', 'Have you (or the person you are helping) had a fall?', 'event', ['\\b(?:fell|fallen)\\b', 'had a fall', '\\bfall(?:ing)? (?:down|over)', 'tripped', 'slipped', 'dustum', 'dustu', 'dusme', 'kaydim'], 'exposure'),
  f('head-injury', 'Hit the head', 'Was the head hit or injured?', 'event', ['hit (?:my |the |his |her )?head', 'head injury', 'bump\\w* (?:my )?head', 'basimi carp', 'kafami carp', 'basini vurdu'], 'exposure'),
]

export const FINDING_BY_ID: Record<string, FindingDef> = Object.fromEntries(FINDINGS.map((x) => [x.id, x]))

/** Quick-pick chips for the start of a consultation (most common complaints first). */
export const STARTER_FINDINGS = ['chest-pain', 'breathless', 'headache', 'lightheaded', 'nausea', 'fever', 'palpitations', 'back-pain', 'fatigue', 'insomnia', 'low-mood', 'fall']
