/**
 * Lightweight i18n system.
 * Maps language display names to translation dictionaries.
 */

const en = {
  // Topbar & Navigation
  searchPlaceholder: 'Search across all meetings...',
  record: 'Record',
  recordAudio: 'Record Audio',
  recordScreen: 'Record Screen',
  takePicture: 'Take Picture',
  uploadAudio: 'Upload Audio',
  uploadVideo: 'Upload Video',
  uploadImage: 'Upload Image',
  uploadText: 'Upload Text',
  pasteMemory: 'Paste Memory',
  system: 'System',
  mic: 'Mic',

  // Sessions view
  yourMeetings: 'Your Meetings',
  startNewSession: 'Start a new session or review past conversations',

  // Search
  searching: 'Searching...',
  results: 'results',
  result: 'result',
  forQuery: 'for',
  fullText: 'Full Text',
  exactMatch: 'Exact Match',
  searchingAll: 'Searching across all sessions...',
  noResults: 'No results found for',
  searchHint: 'Try different keywords or search by tag (e.g. #meeting)',

  // Session detail
  transcription: 'Transcription',
  live: 'Live',
  summary: 'Summary',
  ai: 'AI',
  document: 'Document',
  summaryLabel: 'Summary',
  noTranscript: 'No transcript saved',
  noSummary: 'No summary saved for this session',
  noDocument: 'No document generated',
  statements: '💬 Statements',
  facts: '📌 Facts',
  questions: '❓ Questions',
  unclearPoints: '🔍 Unclear Points',
  noItems: 'No items recorded',
  noUnclearPoints: 'No unclear points recorded',

  // Recording view
  transcriptionLive: 'Transcription',
  statementsAndFacts: 'Statements & Facts',
  documentMode: 'Document',
  listeningForAudio: 'Listening for audio...',
  waitingForSummary: 'Waiting for first summary cycle...',
  documentWillAppear: 'Document will appear after first summary cycle...',
  stopRecording: 'Stop Recording',
  processing: 'Processing...',
  finalizingSession: 'Finalizing session...',

  // Settings
  settings: 'Settings',
  colorTheme: 'Color Theme',
  language: 'Language',
  save: 'Save',
  cancel: 'Cancel',

  // Auth
  signIn: 'Sign In',
  register: 'Register',
  email: 'Email',
  password: 'Password',
  confirmPassword: 'Confirm Password',
  displayName: 'Display Name (optional)',

  // Sidebar
  sessions: 'Sessions',
  tags: 'Tags',
  newTag: 'New tag...',
  noSessions: 'No sessions yet',
  person: 'Person',

  // Token display
  inputTokens: 'In',
  outputTokens: 'Out',
  cost: 'Cost',

  // Debug
  debugLog: 'Debug Log',

  // Paste Memory
  pasteMemoryTitle: 'Paste Memory',
  pasteMemoryPlaceholder: 'Paste your text, notes, meeting transcript, or any content here...',
  pasteMemoryAnalyze: 'Analyze',
  pasteMemoryAnalyzing: 'Analyzing...',
}

type TranslationKeys = typeof en

const vi: TranslationKeys = {
  searchPlaceholder: 'Tìm kiếm trong tất cả cuộc họp...',
  record: 'Ghi âm',
  recordAudio: 'Ghi Âm',
  recordScreen: 'Ghi Màn Hình',
  takePicture: 'Chụp Ảnh',
  uploadAudio: 'Tải Âm Thanh',
  uploadVideo: 'Tải Video',
  uploadImage: 'Tải Hình Ảnh',
  uploadText: 'Tải Văn Bản',
  pasteMemory: 'Dán Ghi Nhớ',
  system: 'Hệ thống',
  mic: 'Micro',

  yourMeetings: 'Cuộc Họp Của Bạn',
  startNewSession: 'Bắt đầu phiên mới hoặc xem lại các cuộc trò chuyện',

  searching: 'Đang tìm...',
  results: 'kết quả',
  result: 'kết quả',
  forQuery: 'cho',
  fullText: 'Toàn Văn',
  exactMatch: 'Chính Xác',
  searchingAll: 'Đang tìm kiếm trong tất cả phiên...',
  noResults: 'Không tìm thấy kết quả cho',
  searchHint: 'Thử từ khóa khác hoặc tìm theo thẻ (vd: #meeting)',

  transcription: 'Phiên Âm',
  live: 'Trực tiếp',
  summary: 'Tóm Tắt',
  ai: 'AI',
  document: 'Tài Liệu',
  summaryLabel: 'Tóm Tắt',
  noTranscript: 'Chưa có phiên âm',
  noSummary: 'Chưa có tóm tắt cho phiên này',
  noDocument: 'Chưa có tài liệu',
  statements: '💬 Phát Biểu',
  facts: '📌 Sự Kiện',
  questions: '❓ Câu Hỏi',
  unclearPoints: '🔍 Điểm Chưa Rõ',
  noItems: 'Chưa có mục nào',
  noUnclearPoints: 'Không có điểm chưa rõ',

  transcriptionLive: 'Phiên Âm',
  statementsAndFacts: 'Phát Biểu & Sự Kiện',
  documentMode: 'Tài Liệu',
  listeningForAudio: 'Đang lắng nghe âm thanh...',
  waitingForSummary: 'Đang chờ chu kỳ tóm tắt đầu tiên...',
  documentWillAppear: 'Tài liệu sẽ xuất hiện sau chu kỳ tóm tắt đầu tiên...',
  stopRecording: 'Dừng Ghi',
  processing: 'Đang xử lý...',
  finalizingSession: 'Đang hoàn tất phiên...',

  settings: 'Cài Đặt',
  colorTheme: 'Giao Diện Màu',
  language: 'Ngôn Ngữ',
  save: 'Lưu',
  cancel: 'Hủy',

  signIn: 'Đăng Nhập',
  register: 'Đăng Ký',
  email: 'Email',
  password: 'Mật Khẩu',
  confirmPassword: 'Xác Nhận Mật Khẩu',
  displayName: 'Tên Hiển Thị (tùy chọn)',

  sessions: 'Phiên',
  tags: 'Thẻ',
  newTag: 'Thẻ mới...',
  noSessions: 'Chưa có phiên nào',
  person: 'Người',

  inputTokens: 'Vào',
  outputTokens: 'Ra',
  cost: 'Chi phí',

  debugLog: 'Nhật Ký Gỡ Lỗi',

  pasteMemoryTitle: 'Dán Ghi Nhớ',
  pasteMemoryPlaceholder: 'Dán văn bản, ghi chú, biên bản họp hoặc nội dung bất kỳ vào đây...',
  pasteMemoryAnalyze: 'Phân Tích',
  pasteMemoryAnalyzing: 'Đang phân tích...',
}

const es: TranslationKeys = {
  searchPlaceholder: 'Buscar en todas las reuniones...',
  record: 'Grabar',
  recordAudio: 'Grabar Audio',
  recordScreen: 'Grabar Pantalla',
  takePicture: 'Tomar Foto',
  uploadAudio: 'Subir Audio',
  uploadVideo: 'Subir Video',
  uploadImage: 'Subir Imagen',
  uploadText: 'Subir Texto',
  pasteMemory: 'Pegar Memoria',
  system: 'Sistema',
  mic: 'Micro',
  yourMeetings: 'Tus Reuniones',
  startNewSession: 'Inicia una nueva sesión o revisa conversaciones pasadas',
  searching: 'Buscando...',
  results: 'resultados',
  result: 'resultado',
  forQuery: 'para',
  fullText: 'Texto Completo',
  exactMatch: 'Coincidencia Exacta',
  searchingAll: 'Buscando en todas las sesiones...',
  noResults: 'No se encontraron resultados para',
  searchHint: 'Prueba con otras palabras clave o busca por etiqueta (ej: #reunión)',
  transcription: 'Transcripción',
  live: 'En vivo',
  summary: 'Resumen',
  ai: 'IA',
  document: 'Documento',
  summaryLabel: 'Resumen',
  noTranscript: 'Sin transcripción guardada',
  noSummary: 'Sin resumen guardado para esta sesión',
  noDocument: 'Sin documento generado',
  statements: '💬 Declaraciones',
  facts: '📌 Hechos',
  questions: '❓ Preguntas',
  unclearPoints: '🔍 Puntos Poco Claros',
  noItems: 'Sin elementos registrados',
  noUnclearPoints: 'Sin puntos poco claros',
  transcriptionLive: 'Transcripción',
  statementsAndFacts: 'Declaraciones y Hechos',
  documentMode: 'Documento',
  listeningForAudio: 'Escuchando audio...',
  waitingForSummary: 'Esperando el primer ciclo de resumen...',
  documentWillAppear: 'El documento aparecerá después del primer ciclo...',
  stopRecording: 'Detener Grabación',
  processing: 'Procesando...',
  finalizingSession: 'Finalizando sesión...',
  settings: 'Configuración',
  colorTheme: 'Tema de Color',
  language: 'Idioma',
  save: 'Guardar',
  cancel: 'Cancelar',
  signIn: 'Iniciar Sesión',
  register: 'Registrarse',
  email: 'Correo',
  password: 'Contraseña',
  confirmPassword: 'Confirmar Contraseña',
  displayName: 'Nombre (opcional)',
  sessions: 'Sesiones',
  tags: 'Etiquetas',
  newTag: 'Nueva etiqueta...',
  noSessions: 'Sin sesiones aún',
  person: 'Persona',
  inputTokens: 'Ent',
  outputTokens: 'Sal',
  cost: 'Costo',
  debugLog: 'Registro de Depuración',

  pasteMemoryTitle: 'Pegar Memoria',
  pasteMemoryPlaceholder: 'Pega tu texto, notas, transcripción de reunión o cualquier contenido aquí...',
  pasteMemoryAnalyze: 'Analizar',
  pasteMemoryAnalyzing: 'Analizando...',
}

const translations: Record<string, TranslationKeys> = {
  English: en,
  Vietnamese: vi,
  Spanish: es,
  French: en, // fallback to English for now
  German: en,
  Japanese: en,
  Korean: en,
  'Chinese (Simplified)': en,
}

export function getTranslations(lang: string): TranslationKeys {
  return translations[lang] || en
}

export type { TranslationKeys }
