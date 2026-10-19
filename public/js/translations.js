// The translations to choose from: one for each language alquran.cloud has, by a
// translator well known in it. Each is downloaded the first time it's chosen
// (about 0.5 MB) and kept. In order of `name`, each language's own name for itself.
// `speech` is the voices that can read it, best first (just `code` when left
// out), and `translator` is null where alquran.cloud doesn't name one.

/** @type {{ code: string, name: string, edition: string, translator: string | null, speech?: string[] }[]} */
export const TRANSLATIONS = [
  { code: 'az', name: 'Azərbaycanca', edition: 'az.mammadaliyev', translator: 'Vasim Mammadaliyev and Ziya Bunyadov' },
  { code: 'id', name: 'Bahasa Indonesia', edition: 'id.indonesian', translator: 'the Indonesian Ministry of Religious Affairs' },
  { code: 'bs', name: 'Bosanski', edition: 'bs.korkut', translator: 'Besim Korkut' },
  { code: 'cs', name: 'Čeština', edition: 'cs.hrbek', translator: 'Ivan Hrbek' },
  { code: 'de', name: 'Deutsch', edition: 'de.bubenheim', translator: 'A. S. F. Bubenheim and N. Elyas' },
  { code: 'en', name: 'English', edition: 'en.sahih', translator: 'Saheeh International', speech: ['en-US', 'en'] },
  { code: 'es', name: 'Español', edition: 'es.cortes', translator: 'Julio Cortés', speech: ['es-ES', 'es'] },
  { code: 'fr', name: 'Français', edition: 'fr.hamidullah', translator: 'Muhammad Hamidullah', speech: ['fr-FR', 'fr'] },
  { code: 'ha', name: 'Hausa', edition: 'ha.gumi', translator: 'Abubakar Mahmoud Gumi' },
  { code: 'it', name: 'Italiano', edition: 'it.piccardo', translator: 'Hamza Roberto Piccardo' },
  { code: 'sw', name: 'Kiswahili', edition: 'sw.barwani', translator: 'Ali Muhsin Al-Barwani' },
  { code: 'ms', name: 'Melayu', edition: 'ms.basmeih', translator: 'Abdullah Muhammad Basmeih', speech: ['ms-MY', 'ms'] },
  { code: 'nl', name: 'Nederlands', edition: 'nl.siregar', translator: 'Sofian S. Siregar' },
  { code: 'no', name: 'Norsk', edition: 'no.berg', translator: 'Einar Berg', speech: ['nb', 'no', 'nn'] },
  { code: 'pl', name: 'Polski', edition: 'pl.bielawskiego', translator: 'Józef Bielawski' },
  { code: 'pt', name: 'Português', edition: 'pt.elhayek', translator: 'Samir El-Hayek', speech: ['pt-BR', 'pt'] },
  { code: 'ro', name: 'Română', edition: 'ro.grigore', translator: 'George Grigore' },
  { code: 'sq', name: 'Shqip', edition: 'sq.ahmeti', translator: 'Sherif Ahmeti' },
  { code: 'so', name: 'Soomaali', edition: 'so.abduh', translator: 'Mahmud Muhammad Abduh' },
  { code: 'sv', name: 'Svenska', edition: 'sv.bernstrom', translator: 'Knut Bernström' },
  { code: 'kab', name: 'Taqbaylit', edition: 'ber.mensur', translator: 'Ramdane At Mansour' },
  { code: 'tr', name: 'Türkçe', edition: 'tr.diyanet', translator: 'Diyanet İşleri' },
  { code: 'bg', name: 'Български', edition: 'bg.theophanov', translator: 'Tzvetan Theophanov' },
  { code: 'ce', name: 'Нохчийн', edition: 'ce.magomedov', translator: 'Magomedov' },
  { code: 'ru', name: 'Русский', edition: 'ru.kuliev', translator: 'Elmir Kuliev' },
  { code: 'tt', name: 'Татарча', edition: 'tt.nugman', translator: 'Yakub ibn Nugman' },
  { code: 'tg', name: 'Тоҷикӣ', edition: 'tg.ayati', translator: 'AbdolMohammad Ayati' },
  { code: 'uz', name: 'Ўзбекча', edition: 'uz.sodik', translator: 'Muhammad Sodik Muhammad Yusuf' },
  { code: 'ur', name: 'اردو', edition: 'ur.jalandhry', translator: 'Fateh Muhammad Jalandhry' },
  { code: 'ps', name: 'پښتو', edition: 'ps.abdulwali', translator: 'Abdul Wali' },
  { code: 'sd', name: 'سنڌي', edition: 'sd.amroti', translator: 'Taj Mehmood Amroti' },
  { code: 'fa', name: 'فارسی', edition: 'fa.fooladvand', translator: 'Mohammad Mahdi Fooladvand' },
  { code: 'ckb', name: 'کوردی', edition: 'ku.asan', translator: 'Burhan Muhammad-Amin' },
  { code: 'ug', name: 'ئۇيغۇرچە', edition: 'ug.saleh', translator: 'Muhammad Saleh' },
  { code: 'dv', name: 'ދިވެހި', edition: 'dv.divehi', translator: 'the Office of the President of the Maldives' },
  { code: 'am', name: 'አማርኛ', edition: 'am.sadiq', translator: 'Sadiq and Sani Habib' },
  { code: 'hi', name: 'हिन्दी', edition: 'hi.hindi', translator: 'Suhel Farooq Khan and Saifur Rahman Nadwi' },
  { code: 'bn', name: 'বাংলা', edition: 'bn.bengali', translator: 'Muhiuddin Khan' },
  { code: 'ta', name: 'தமிழ்', edition: 'ta.tamil', translator: 'Jan Trust Foundation' },
  { code: 'ml', name: 'മലയാളം', edition: 'ml.abdulhameed', translator: 'Cheriyamundam Abdul Hameed and Kunhi Mohammed Parappoor' },
  { code: 'si', name: 'සිංහල', edition: 'si.naseemismail', translator: 'Naseem Ismail and Masoor Maulana Kaleel' },
  { code: 'th', name: 'ไทย', edition: 'th.thai', translator: 'the King Fahd Quran Complex' },
  { code: 'my', name: 'မြန်မာ', edition: 'my.ghazi', translator: 'Ghazi Muhammad Hashim' },
  { code: 'zh', name: '中文', edition: 'zh.jian', translator: 'Ma Jian', speech: ['zh-CN', 'zh'] },
  { code: 'ja', name: '日本語', edition: 'ja.japanese', translator: null },
  { code: 'ko', name: '한국어', edition: 'ko.korean', translator: null },
];

const BY_CODE = new Map(TRANSLATIONS.map((t) => [t.code, t]));

/** @param {string} code a translation's `code`, or 'none' */
export const translation = (code) => BY_CODE.get(code) ?? null;
