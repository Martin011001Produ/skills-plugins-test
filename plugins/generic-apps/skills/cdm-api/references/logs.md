# Leer logs y resultados

Leelo antes de interpretar `logs` o `payload` de una ejecución, o de concluir si algo salió bien o mal.

- **Demoras.** Las ejecuciones aparecen en el CDM entre 1 y 3 minutos después del evento, y los logs hasta 5 minutos después. Si a más de 5 minutos `logs` sigue en `[]`, esa integration no registra logs: el resultado está en el `status`, el `error_type` y el `output_message` de la ejecución, o en el payload.
- **Los logs llegan de a partes, no todos juntos.** Una ejecución puede mostrar las primeras llamadas (por ejemplo el `GET` del producto y un `images/upload`) y sumar las siguientes (el `POST` final al canal) minutos después. Si la ejecución tiene menos de 5 minutos, no concluyas que una llamada no se hizo porque no aparece en los logs: volvé a pedirlos más tarde.
- **Formato de cada log.** Cada log trae un campo `message` cuyo contenido depende de la app. Mirá sus claves antes de leerlo. Estos son los formatos conocidos, pero **hay más**: si `message` no coincide con ninguno, no fuerces la tabla. Leé las claves que trae, buscá algo que indique request, response y resultado (status, error, flags tipo `uploaded` o `success`) y decile al usuario que es un formato nuevo.

  | Formato | Cómo reconocerlo | Request | Response | ¿Salió bien? |
  |---|---|---|---|---|
  | Llamada HTTP con JSON (ej. TikTok) | `message.request` con `url` y `method` | `request.method`, `request.baseURL` + `request.url`, `request.params`, `request.body` (objeto) | `message.body` (objeto) | `statusCode` y `fulfilled: true` |
  | Llamada HTTP con XML/SOAP (ej. NetSuite, Facturante) | Igual, pero `request.body` y `body` son strings XML | `request.body` (string XML) | `message.body` (string XML: buscá el resultado adentro, por ejemplo `isSuccess`, `Estado`) | `statusCode`, `fulfilled` y `error` (`null` si no hubo error) |
  | Llamada HTTP fallida (ej. ERP de Pierce) | `fulfilled: false` y `error` con texto | `request.url`, `request.method`, `request.qs` (query string), a veces sin body | Puede no venir `body` | `statusCode` (ej. 504) y `error` (ej. `"error code: 504"`) |
  | Subida de archivo (ej. XML de ventas a un FTP) | Sin `request`; trae `fileName`, `host`, `content` | `fileName`, `host`, `baseFolder`, `bytes` y `content` (el archivo completo) | — | `uploaded: true/false` |
  | Texto plano | `message` es un string | — | — | Leé el texto |

  Un 200 o un `fulfilled: true` dice que la llamada respondió, no que el sistema externo aceptó el dato: en SOAP o en respuestas con su propio estado, el resultado real está dentro del body.
- **Los logs traen datos sensibles.** Pueden incluir credenciales de terceros (hashes de facturación, `access_token` en URLs, tokens en headers) y datos personales (nombres, DNI, mails, direcciones). No los copies al chat ni a documentos: citá solo los campos que hacen falta para la conclusión y enmascará el resto (por ejemplo, `Hash: ***`).
- **Las requests internas de Producteca hacia sus propios servicios nunca se loguean:** las llamadas a la API de productos, a channels-api, etc. Solo se loguean las llamadas a sistemas externos, como la API de un canal. Para una acción interna vas a tener, como mucho, la ejecución con su estado (y el change, si la company los registra), pero nunca el request y la response. El efecto se verifica leyendo la entidad en la API (`resource`). Una llamada interna que el código hace directo, sin pasar por el sistema de mensajes, tampoco deja ejecución.
- **Un 200 en los logs no significa que la ejecución salió bien.** Puede pasar que la llamada al canal responda 200 y la ejecución termine `unsuccessful` por un error posterior en una llamada interna de Producteca, que no se loguea. Ejemplo (TikTok, publicar una variante): el `partial_edit` aparece con 200, pero la ejecución falla con `entity_not_found` al actualizar la variationIntegration. No siempre pasa, pero el resultado final siempre está en el `status` y el `output_message` de la ejecución: miralos antes de concluir.
- **El payload a veces sirve de log:** muchas apps loguean poco y lo útil (lo que se mandó al canal) está en el payload.
