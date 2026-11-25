---
type: Fixed
---
**Peticiones y mocks en apps AngularJS:** las plantillas (`templateUrl`) y otros ficheros estáticos pedidos por XHR del mismo origen ya no cuentan como peticiones de la app, así que mover una plantilla en un restyle no se marca como cambio estructural. Un `match.url` de mock escrito con origen (`https://api.ejemplo.com/v1/items`) ahora coincide igual que `/v1/items`.
