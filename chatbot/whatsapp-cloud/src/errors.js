// Mapa de códigos de error de Meta → explicación en lenguaje natural.
// Fuente: developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
// gravedad: 'info' | 'warn' | 'error'
export const ERROR_MAP = {
  0:      { titulo: 'Token inválido o vencido', explica: 'El token de acceso no sirve o expiró.', accion: 'Genera un token nuevo (System User permanente) y ponlo en el .env.', gravedad: 'error' },
  190:    { titulo: 'Token vencido', explica: 'El token de acceso caducó (los temporales duran 24h).', accion: 'Reemplaza META_TOKEN por uno permanente de System User.', gravedad: 'error' },
  100:    { titulo: 'Parámetro inválido', explica: 'Meta rechazó un campo de la petición.', accion: 'Revisa el número destino y el cuerpo del mensaje.', gravedad: 'error' },
  131047: { titulo: 'Fuera de la ventana de 24h', explica: 'Pasaron más de 24h desde el último mensaje del cliente. No se puede enviar texto libre.', accion: 'Envía una plantilla aprobada para reabrir la conversación.', gravedad: 'warn' },
  131051: { titulo: 'Tipo de mensaje no soportado', explica: 'Ese tipo de mensaje no se puede enviar por Cloud API.', accion: 'Usa texto o un tipo soportado.', gravedad: 'error' },
  131026: { titulo: 'El destino no tiene WhatsApp', explica: 'El número no está registrado en WhatsApp o no puede recibir mensajes.', accion: 'Verifica el número del cliente.', gravedad: 'warn' },
  131030: { titulo: 'Destino no permitido (número de prueba)', explica: 'Con número de prueba solo puedes escribir a destinatarios registrados. No aplica con número real verificado.', accion: 'Agrega el número a la lista de prueba, o usa el número de producción.', gravedad: 'warn' },
  130403: { titulo: 'El cliente te bloqueó o límite de negocio', explica: 'El usuario bloqueó tu número o excediste un límite de mensajería.', accion: 'No puedes escribirle. Espera o revisa límites en el panel de Meta.', gravedad: 'warn' },
  131031: { titulo: 'Cuenta restringida', explica: 'Tu cuenta de WhatsApp Business fue restringida o inhabilitada.', accion: 'Revisa la calidad y el estado de la WABA en Business Manager.', gravedad: 'error' },
  132001: { titulo: 'Plantilla no aprobada / inexistente', explica: 'La plantilla no existe o no está aprobada por Meta.', accion: 'Crea y espera la aprobación de la plantilla en el Administrador de WhatsApp.', gravedad: 'error' },
  131053: { titulo: 'No se pudo enviar la media', explica: 'WhatsApp rechazó el archivo: formato no soportado, dañado o muy grande. Las notas de voz grabadas en Chrome salen en webm y WhatsApp exige ogg/opus.', accion: 'Envía audios como archivo (mp3/ogg) con 📎, o graba la nota de voz desde Firefox. Fotos/videos/PDF normales sí funcionan.', gravedad: 'warn' },
  131052: { titulo: 'No se pudo descargar la media', explica: 'No se pudo bajar el archivo del mensaje del cliente.', accion: 'Pídele al cliente que lo reenvíe, o inténtalo de nuevo.', gravedad: 'warn' },
  132000: { titulo: 'Parámetros de plantilla no coinciden', explica: 'El número de variables enviadas no coincide con la plantilla.', accion: 'Ajusta los componentes/variables al formato de la plantilla.', gravedad: 'error' },
  80007:  { titulo: 'Límite de velocidad (rate limit)', explica: 'Se enviaron demasiadas peticiones en poco tiempo.', accion: 'Espera unos segundos y reintenta.', gravedad: 'warn' },
  130429: { titulo: 'Límite de mensajería alcanzado', explica: 'Alcanzaste el tope de mensajes de tu nivel actual.', accion: 'Espera a que se reinicie la ventana o sube de nivel de calidad.', gravedad: 'warn' },
  131056: { titulo: 'Demasiados mensajes al mismo número', explica: 'Rate limit por pareja emisor/receptor.', accion: 'Espacia los envíos a ese número.', gravedad: 'warn' },
  368:    { titulo: 'Bloqueo temporal por políticas', explica: 'Meta bloqueó temporalmente la acción por políticas de la plataforma.', accion: 'Revisa el estado de la cuenta y espera.', gravedad: 'error' },
};

export const ERROR_FALLBACK = {
  titulo: 'Error de WhatsApp',
  explica: 'Meta devolvió un error no catalogado.',
  accion: 'Revisa el código y el mensaje crudo, o la documentación de error-codes de Meta.',
  gravedad: 'error',
};

export function explainError(code) {
  return ERROR_MAP[code] || ERROR_FALLBACK;
}
