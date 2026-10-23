export interface LocalLandmark {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: "shopping" | "hospital" | "residential" | "transport" | "education" | "landmark";
  subtitle: string;
  aliases: string[];
}

export const TALEGAON_CENTER = {
  lat: 18.7350,
  lon: 73.6750,
  name: "Talegaon Dabhade",
};

export const TALEGAON_LANDMARKS: LocalLandmark[] = [
  // ==========================================
  // 1. SHOPPING & MARKETS
  // ==========================================
  {
    id: "shop-dmart-talegaon",
    name: "DMart, Talegaon Dabhade",
    lat: 18.7296,
    lon: 73.6708,
    category: "shopping",
    subtitle: "Talegaon-Chakan Road, Yashwant Nagar",
    aliases: [
      "dmart", "d mart", "d-mart", "dmar", "dmart talegaon", "d mart talegaon",
      "d-mart talegaon", "supermarket", "grocery store", "hypermarket"
    ],
  },
  {
    id: "shop-zudio-talegaon",
    name: "Zudio, The Pinnacle",
    lat: 18.7213,
    lon: 73.6685,
    category: "shopping",
    subtitle: "Star Bazaar, The Pinnacle, Tukaram Nagar, Talegaon Dabhade",
    aliases: [
      "zudio", "zudi", "zudio talegaon", "tata zudio", "the pinnacle",
      "pinnacle", "star bazaar zudio", "clothing", "fashion store"
    ],
  },
  {
    id: "shop-star-bazaar-talegaon",
    name: "Star Bazaar, The Pinnacle",
    lat: 18.7213,
    lon: 73.6685,
    category: "shopping",
    subtitle: "The Pinnacle, Near Naiknavare Neelaya, Tukaram Nagar, Talegaon Dabhade",
    aliases: [
      "star bazaar", "star bazar", "star market", "star hypermarket",
      "the pinnacle", "star bazaar talegaon", "supermarket", "grocery"
    ],
  },
  {
    id: "shop-reliance-smart-talegaon",
    name: "Reliance Smart Point, Station Road",
    lat: 18.7335,
    lon: 73.6765,
    category: "shopping",
    subtitle: "Station Road, Maruti Mandir Chowk, Talegaon Dabhade",
    aliases: [
      "reliance smart", "smart point", "reliance smart point", "reliance fresh",
      "reliance store", "reliance talegaon", "supermarket"
    ],
  },
  {
    id: "shop-more-supermarket",
    name: "More Supermarket, Talegaon",
    lat: 18.7342,
    lon: 73.6780,
    category: "shopping",
    subtitle: "Station Road, Talegaon Dabhade",
    aliases: [
      "more supermarket", "more store", "more retail", "more grocery"
    ],
  },
  {
    id: "shop-talegaon-bazar-peth",
    name: "Talegaon Weekly Market (Bazar Peth)",
    lat: 18.7365,
    lon: 73.6845,
    category: "shopping",
    subtitle: "Bazar Peth / Market Yard, Talegaon Dabhade",
    aliases: [
      "bazar peth", "market", "talegaon market", "vegetable market",
      "weekly market", "bazar maidan", "sabzi mandi", "bazaar"
    ],
  },

  // ==========================================
  // 2. HOSPITALS & HEALTHCARE
  // ==========================================
  {
    id: "hosp-harneshwar-hospital",
    name: "Harneshwar Multispeciality Hospital",
    lat: 18.7336,
    lon: 73.6647,
    category: "hospital",
    subtitle: "50-51 Harneshwar Society, Talegaon-Chakan Road, Talegaon Dabhade",
    aliases: [
      "harneshwar hospital", "shree harneshwar clinic", "harneshwar multispeciality",
      "harneshwar", "harne", "harneshwar clinic", "harneshwar multispeciality hospital",
      "shree harneshwar hospital", "harneshwar healthcare"
    ],
  },
  {
    id: "hosp-mimer-rural-hospital",
    name: "MIMER Medical College & Bhausaheb Sardesai Rural Hospital",
    lat: 18.7352,
    lon: 73.6751,
    category: "hospital",
    subtitle: "MIMER Campus, Station Road, Talegaon Dabhade",
    aliases: [
      "mimer hospital", "mimer", "mimer medical college", "bhausaheb sardesai hospital",
      "talegaon rural hospital", "general hospital", "rural hospital", "garware blood bank"
    ],
  },
  {
    id: "hosp-pawana-hospital",
    name: "Pawana Multispeciality Hospital",
    lat: 18.7115,
    lon: 73.6742,
    category: "hospital",
    subtitle: "Somatane Phata, Old Mumbai-Pune Highway, Talegaon Dabhade",
    aliases: [
      "pawana hospital", "pavana hospital", "somatane hospital", "pawna hospital",
      "pawana multispeciality hospital"
    ],
  },
  {
    id: "hosp-samartha-hospital",
    name: "Samartha Hospital",
    lat: 18.7277,
    lon: 73.6792,
    category: "hospital",
    subtitle: "Jijamata Chowk, Chakan Road, Talegaon Dabhade",
    aliases: [
      "samartha hospital", "samarth hospital", "samartha clinic"
    ],
  },
  {
    id: "hosp-unique-hospital",
    name: "Unique Hospital",
    lat: 18.7344,
    lon: 73.6903,
    category: "hospital",
    subtitle: "Urse Road, Talegaon Dabhade",
    aliases: [
      "unique hospital", "unique clinic"
    ],
  },
  {
    id: "hosp-atharva-hospital",
    name: "Atharva Hospital",
    lat: 18.7340,
    lon: 73.6730,
    category: "hospital",
    subtitle: "Station Road, Talegaon Dabhade",
    aliases: [
      "atharva hospital", "atharv hospital"
    ],
  },
  {
    id: "hosp-sevadham-hospital",
    name: "Sevadham Hospital",
    lat: 18.7385,
    lon: 73.6775,
    category: "hospital",
    subtitle: "Varale Road, Talegaon Dabhade",
    aliases: [
      "sevadham hospital", "sevadham"
    ],
  },

  // ==========================================
  // 3. RESIDENTIAL AREAS & HOUSING SOCIETIES
  // ==========================================
  {
    id: "res-real-dream-home",
    name: "Real Dream Home, Ambi Road",
    lat: 18.7297,
    lon: 73.6792,
    category: "residential",
    subtitle: "Survey No. 72, Ambi Road, Village Varale, Talegaon Dabhade",
    aliases: [
      "real dream home", "real dream", "real buildcon", "real dream homes",
      "ambi road varale", "dream home", "dream homes", "real dream society"
    ],
  },
  {
    id: "res-naiknavare-neelaya",
    name: "Naiknavare Neelaya",
    lat: 18.7213,
    lon: 73.6685,
    category: "residential",
    subtitle: "Near The Pinnacle, Tukaram Nagar, Talegaon Dabhade",
    aliases: [
      "naiknavare neelaya", "neelaya", "naiknavare", "neelaya society",
      "naiknavare apartments"
    ],
  },
  {
    id: "res-eco-city-talegaon",
    name: "Namrata Eco City",
    lat: 18.7395,
    lon: 73.6780,
    category: "residential",
    subtitle: "Ambi Road, near MIDC, Talegaon Dabhade",
    aliases: [
      "eco city", "ecocity", "namrata eco city", "eco city 2", "eco city 1"
    ],
  },
  {
    id: "res-harneshwar-society",
    name: "Harneshwar Society",
    lat: 18.7346,
    lon: 73.6639,
    category: "residential",
    subtitle: "Urse Talegaon Road, Talegaon Dabhade",
    aliases: [
      "harneshwar society", "harneshwar nagar", "harneshwar park"
    ],
  },
  {
    id: "res-yashada-splendid-park",
    name: "Yashada Splendid Park",
    lat: 18.7315,
    lon: 73.6725,
    category: "residential",
    subtitle: "Near Railway Station, Talegaon Dabhade",
    aliases: [
      "yashada splendid park", "splendid park", "yashada", "splendid park society"
    ],
  },
  {
    id: "res-lake-paradise",
    name: "Namrata Lake Paradise",
    lat: 18.7420,
    lon: 73.6760,
    category: "residential",
    subtitle: "Varale Road, Talegaon Dabhade",
    aliases: [
      "lake paradise", "namrata lake paradise", "lake paradise society"
    ],
  },
  {
    id: "res-royal-palms",
    name: "Royal Palms Residency",
    lat: 18.7240,
    lon: 73.6690,
    category: "residential",
    subtitle: "Tukaram Nagar, Talegaon Dabhade",
    aliases: [
      "royal palms", "royal palms talegaon"
    ],
  },
  {
    id: "res-swaraj-nagari",
    name: "Swaraj Nagari",
    lat: 18.7320,
    lon: 73.6820,
    category: "residential",
    subtitle: "Talegaon Dabhade",
    aliases: [
      "swaraj nagari", "swaraj nagar"
    ],
  },
  {
    id: "res-yashwant-nagar",
    name: "Yashwant Nagar",
    lat: 18.7380,
    lon: 73.6870,
    category: "residential",
    subtitle: "Talegaon-Chakan Road, Talegaon Dabhade",
    aliases: [
      "yashwant nagar", "yashwantnagar", "yashwant nagar talegaon"
    ],
  },
  {
    id: "res-tukaram-nagar",
    name: "Tukaram Nagar",
    lat: 18.7225,
    lon: 73.6680,
    category: "residential",
    subtitle: "Near The Pinnacle / Star Bazaar, Talegaon Dabhade",
    aliases: [
      "tukaram nagar", "tukaramnagar"
    ],
  },

  // ==========================================
  // 4. TRANSPORT & JUNCTIONS
  // ==========================================
  {
    id: "trans-talegaon-railway-station",
    name: "Talegaon Railway Station",
    lat: 18.7367,
    lon: 73.6705,
    category: "transport",
    subtitle: "Station Road, Talegaon Dabhade",
    aliases: [
      "talegaon railway station", "talegaon station", "station", "railway station",
      "train station", "talegaon rly station", "local station"
    ],
  },
  {
    id: "trans-talegaon-st-stand",
    name: "Talegaon ST Stand (Bus Depot)",
    lat: 18.7347,
    lon: 73.6713,
    category: "transport",
    subtitle: "MSRTC Central Bus Stand, Talegaon Dabhade",
    aliases: [
      "talegaon st stand", "st stand", "bus stand", "bus stop", "msrtc depot",
      "talegaon bus stand", "st depot"
    ],
  },
  {
    id: "trans-maruti-mandir-chowk",
    name: "Maruti Mandir Chowk",
    lat: 18.7348,
    lon: 73.6760,
    category: "transport",
    subtitle: "Station Road, Talegaon Dabhade",
    aliases: [
      "maruti mandir chowk", "maruti chowk", "maruti mandir"
    ],
  },
  {
    id: "trans-jijamata-chowk",
    name: "Jijamata Chowk",
    lat: 18.7350,
    lon: 73.6795,
    category: "transport",
    subtitle: "Talegaon-Chakan Road, Talegaon Dabhade",
    aliases: [
      "jijamata chowk", "jijau chowk", "jijamata"
    ],
  },
  {
    id: "trans-limb-phata",
    name: "Limb Phata",
    lat: 18.7285,
    lon: 73.6650,
    category: "transport",
    subtitle: "Old Mumbai-Pune Highway, Talegaon Dabhade",
    aliases: [
      "limb phata", "limbfata", "limb fata", "limb phata chowk"
    ],
  },
  {
    id: "trans-somatane-phata",
    name: "Somatane Phata",
    lat: 18.7125,
    lon: 73.6755,
    category: "transport",
    subtitle: "Old Mumbai-Pune Highway, Somatane",
    aliases: [
      "somatane phata", "somatne phata", "somatane", "somatne fata",
      "somatane toll", "somatane chowk"
    ],
  },
  {
    id: "trans-talegaon-toll-plaza",
    name: "Talegaon Toll Plaza (Urse)",
    lat: 18.7180,
    lon: 73.6350,
    category: "transport",
    subtitle: "Mumbai-Pune Expressway, Urse / Talegaon",
    aliases: [
      "talegaon toll plaza", "talegaon toll", "urse toll plaza", "expressway toll"
    ],
  },
  {
    id: "trans-wadgaon-phata",
    name: "Wadgaon Phata / Chowk",
    lat: 18.7450,
    lon: 73.6420,
    category: "transport",
    subtitle: "Old Mumbai-Pune Highway, Wadgaon Maval",
    aliases: [
      "wadgaon phata", "vadgaon phata", "wadgaon chowk", "vadgaon chowk"
    ],
  },

  // ==========================================
  // 5. EDUCATION & INSTITUTIONS
  // ==========================================
  {
    id: "edu-iiit-pune",
    name: "IIIT Pune (Indian Institute of Information Technology)",
    lat: 18.7659,
    lon: 73.6848,
    category: "education",
    subtitle: "Survey No. 25 & 27, Near NH48, Bhegade Vasti, Talegaon Dabhade",
    aliases: [
      "iiit pune", "iiit", "indian institute of information technology",
      "iiit talegaon", "iiit campus"
    ],
  },
  {
    id: "edu-dypatil-ambi",
    name: "D.Y. Patil College of Engineering (Ambi)",
    lat: 18.7485,
    lon: 73.6920,
    category: "education",
    subtitle: "D.Y. Patil Technical Campus, Ambi, Talegaon Dabhade",
    aliases: [
      "dy patil", "dy patil ambi", "d y patil college", "dypatil talegaon",
      "dy patil university ambi", "dypatil"
    ],
  },
  {
    id: "edu-nmiet-talegaon",
    name: "Nutan Maharashtra Institute of Engineering & Technology (NMIET)",
    lat: 18.7325,
    lon: 73.6610,
    category: "education",
    subtitle: "Samarth Vidya Sankul, Vishnupuri, Talegaon Dabhade",
    aliases: [
      "nmiet", "nutan maharashtra", "nutan college", "nutan engineering",
      "nutan maharashtra institute"
    ],
  },
  {
    id: "edu-ncer-talegaon",
    name: "Nutan College of Engineering and Research (NCER)",
    lat: 18.7330,
    lon: 73.6605,
    category: "education",
    subtitle: "Vishnupuri, Talegaon Dabhade",
    aliases: [
      "ncer", "nutan college of engineering", "nutan research"
    ],
  },
  {
    id: "edu-tolani-tmi",
    name: "Tolani Maritime Institute (TMI)",
    lat: 18.7635,
    lon: 73.7140,
    category: "education",
    subtitle: "Talegaon-Chakan Road, Induri, Talegaon Dabhade",
    aliases: [
      "tolani", "tolani maritime", "tmi", "tolani maritime institute", "marine college"
    ],
  },
  {
    id: "edu-indira-pharmacy",
    name: "Indira College of Pharmacy",
    lat: 18.7310,
    lon: 73.6630,
    category: "education",
    subtitle: "Vishnupuri, Talegaon Dabhade",
    aliases: [
      "indira college of pharmacy", "indira pharmacy", "indira talegaon"
    ],
  },
  {
    id: "edu-mount-st-ann",
    name: "Mount St. Ann High School & Junior College",
    lat: 18.7370,
    lon: 73.6640,
    category: "education",
    subtitle: "Mount St. Ann Road, Talegaon Dabhade",
    aliases: [
      "mount st ann", "mount saint ann", "st ann school", "mount st ann high school"
    ],
  },
  {
    id: "edu-krishnarao-bhegade",
    name: "Krishnarao Bhegade English Medium School & College",
    lat: 18.7355,
    lon: 73.6810,
    category: "education",
    subtitle: "Talegaon Dabhade",
    aliases: [
      "krishnarao bhegade", "bhegade school", "bhegade college"
    ],
  },

  // ==========================================
  // 6. OTHER LANDMARKS & POPULAR DESTINATIONS
  // ==========================================
  {
    id: "lmk-harneshwar-shiv-temple",
    name: "Harneshwar Shiv Temple",
    lat: 18.7375,
    lon: 73.6646,
    category: "landmark",
    subtitle: "Mount St. Ann Road, Talegaon Dabhade",
    aliases: [
      "harneshwar shiv temple", "harneshwar temple", "harneshwar mandir",
      "harneshwar shiv mandir", "shiv temple talegaon"
    ],
  },
  {
    id: "lmk-birla-ganpati",
    name: "Birla Ganpati Temple",
    lat: 18.7110,
    lon: 73.6780,
    category: "landmark",
    subtitle: "Somatane Phata, Old Mumbai-Pune Highway",
    aliases: [
      "birla ganpati", "birla temple", "birla ganpati somatane", "ganpati temple"
    ],
  },
  {
    id: "lmk-talegaon-lake",
    name: "Talegaon Dabhade Lake (Talav)",
    lat: 18.7380,
    lon: 73.6815,
    category: "landmark",
    subtitle: "Lake Road, Talegaon Dabhade",
    aliases: [
      "talegaon lake", "talegaon talav", "dabhade lake", "bada talav", "lake"
    ],
  },
  {
    id: "lmk-hp-petrol-pump",
    name: "HP Petrol Pump, Chakan Road",
    lat: 18.7305,
    lon: 73.6715,
    category: "landmark",
    subtitle: "Talegaon-Chakan Road, near Yashwant Nagar, Talegaon Dabhade",
    aliases: [
      "hp petrol pump", "hp pump talegaon", "petrol pump chakan road", "fuel station"
    ],
  },
  {
    id: "lmk-ioc-petrol-pump",
    name: "Indian Oil Petrol Pump, Station Road",
    lat: 18.7345,
    lon: 73.6740,
    category: "landmark",
    subtitle: "Station Road, Talegaon Dabhade",
    aliases: [
      "indian oil", "ioc petrol pump", "station road petrol pump", "petrol pump"
    ],
  },
  {
    id: "lmk-sbi-talegaon",
    name: "State Bank of India (SBI)",
    lat: 18.7342,
    lon: 73.6735,
    category: "landmark",
    subtitle: "Station Road, Talegaon Dabhade",
    aliases: [
      "sbi talegaon", "state bank of india", "sbi branch", "sbi atm", "bank"
    ],
  },
  {
    id: "lmk-bank-of-maharashtra",
    name: "Bank of Maharashtra",
    lat: 18.7355,
    lon: 73.6770,
    category: "landmark",
    subtitle: "Station Road, Talegaon Dabhade",
    aliases: [
      "bank of maharashtra", "bom talegaon", "bank"
    ],
  },
  {
    id: "lmk-indrayani-river-ghat",
    name: "Indrayani River Ghat, Induri",
    lat: 18.7610,
    lon: 73.7120,
    category: "landmark",
    subtitle: "Induri / Talegaon",
    aliases: [
      "indrayani river", "induri ghat", "indrayani ghat"
    ],
  },

  // ==========================================
  // 7. KEY REGIONAL TRAVEL HUBS & CONNECTIVITY
  // ==========================================
  {
    id: "reg-pune-railway-station",
    name: "Pune Railway Station",
    lat: 18.5284,
    lon: 73.8739,
    category: "transport",
    subtitle: "Raja Bahadur Mill Road, Sangamvadi, Pune",
    aliases: [
      "pune railway station", "pune station", "pune rly station", "pune train station"
    ],
  },
  {
    id: "reg-shivajinagar-station",
    name: "Shivajinagar Railway Station",
    lat: 18.5314,
    lon: 73.8446,
    category: "transport",
    subtitle: "Shivajinagar, Pune",
    aliases: [
      "shivajinagar", "shivajinagar station", "shivajinagar bus stand", "shivaji nagar"
    ],
  },
  {
    id: "reg-hinjewadi-phase-1",
    name: "Hinjewadi Phase 1 (Rajiv Gandhi Infotech Park)",
    lat: 18.5913,
    lon: 73.7389,
    category: "landmark",
    subtitle: "Hinjewadi IT Park, Pune",
    aliases: [
      "hinjewadi", "hinjawadi", "hinjewadi phase 1", "hinjawadi phase 1", "it park", "rgip"
    ],
  },
  {
    id: "reg-wakad-chowk",
    name: "Wakad Chowk / Dutta Mandir",
    lat: 18.5987,
    lon: 73.7634,
    category: "transport",
    subtitle: "Wakad, Pimpri-Chinchwad, Pune",
    aliases: [
      "wakad", "wakad chowk", "wakad bridge", "dutta mandir wakad", "wakad highway"
    ],
  },
  {
    id: "reg-lonavala-station",
    name: "Lonavala Railway Station / Bus Stand",
    lat: 18.7504,
    lon: 73.4069,
    category: "transport",
    subtitle: "Mahatma Gandhi Road, Lonavala",
    aliases: [
      "lonavala", "lonavla", "lonavala station", "lonavala bus stand", "lonavla station"
    ],
  },
  {
    id: "reg-pune-airport",
    name: "Pune International Airport (PNQ)",
    lat: 18.5804,
    lon: 73.9182,
    category: "transport",
    subtitle: "New Airport Road, Lohegaon, Pune",
    aliases: [
      "pune airport", "pune international airport", "lohegaon airport", "pnq"
    ],
  },
  {
    id: "reg-mumbai-airport-t2",
    name: "Chhatrapati Shivaji Maharaj International Airport (BOM T2)",
    lat: 19.0968,
    lon: 72.8744,
    category: "transport",
    subtitle: "Sahar, Andheri East, Mumbai",
    aliases: [
      "mumbai airport", "mumbai international airport", "bom t2", "csmia", "mumbai t2"
    ],
  },
];
