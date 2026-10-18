---
name: Gestión neutral
description: Interfaz operativa acromática sin identidad comercial
colors:
  primary: "#3e3e3e"
  background: "#f5f5f5"
  surface: "#ffffff"
  text: "#242424"
  secondary: "#606060"
  line: "#e4e4e4"
  dark-background: "#191919"
  dark-surface: "#272727"
  dark-text: "#e6e6e6"
  dark-primary: "#cdcdcd"
  dark-line: "#434343"
typography:
  body:
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif'
    fontSize: "14px"
  entry-title:
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif'
    fontSize: "clamp(28px,5vw,36px)"
    fontWeight: 600
    letterSpacing: "-.025em"
rounded:
  control: "12px"
  card: "14px"
spacing:
  compact: "8px"
  field: "18px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
---

## Overview
Modo Operate. Conserva las tareas de clientes, inventario, cobro y equipo con presentación neutral. La entrada ofrece Dueño y Mesero sin credenciales. El nombre Gestión es una etiqueta funcional.

## Colors
Escala de grises en ambos temas. Los textos secundarios y placeholders claros usan el token secondary. Los placeholders oscuros usan #bdbdbd. Las fotografías de productos conservan sus colores. Los comprobantes mantienen fondo de papel claro.

## Typography
Sans del sistema sin tipografía ornamental. Jerarquía por tamaño y peso. Los controles conservan sus etiquetas operativas en español.

## Layout
Panel lateral en escritorio y navegación inferior en móvil desde 700px. La entrada centra una columna de hasta 540px. Formularios y controles se adaptan al ancho disponible. Las tarjetas de clientes conservan la organización funcional del sistema.

## Elevation & Depth
Superficies con bordes finos. Los diálogos conservan fondo oscurecido para mantener el foco. No hay luces ambientales ni ilustraciones de marca.

## Shapes
Controles de esquinas moderadas. Tarjetas y diálogos usan el radio card. Los botones de icono tienen área de 44px.

## Components
El selector de perfil muestra dos botones y un selector opcional cuando existen varios meseros. La preferencia de tema persiste en gestion-theme. El cambio de modo usa fundido de 550ms con alternativa CSS y cambio inmediato al reducir movimiento.

## Do's and Don'ts
Conservar la escala acromática y los iconos funcionales. No reintroducir logotipos, copas, frases publicitarias ni colores de marca. Verificar contraste en ambos modos y mantener las fotos sin filtros.
