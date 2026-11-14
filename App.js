/*
 * ============================================================================
 *  EQUILIBRA · Cuestionario adaptativo de bienestar emocional
 * ============================================================================
 *
 *  ¿Qué hace la app?
 *  Hace preguntas de dos cuestionarios clínicos muy usados: el GAD-7 (ansiedad)
 *  y el PHQ-9 (depresión). No hace siempre todas: empieza con 4 preguntas de
 *  "tamizaje" y, según lo que contestes, decide si hace falta preguntar más.
 *  Al final muestra un resultado con recomendaciones y, cuando hace falta,
 *  teléfonos de ayuda y especialistas.
 *
 *  La lógica es una copia en JavaScript del backend en Python (NetworkX):
 *  el cuestionario es un GRAFO. La app funciona sin internet y no llama a Python.
 *
 *  ¿Cómo está organizado este archivo?
 *    1. Datos ......... opciones de respuesta, preguntas, recomendaciones y líneas de crisis
 *    2. El grafo ...... nodos (preguntas, evaluaciones y resultados) y aristas (caminos)
 *    3. Lógica ........ puntajes, severidad, siguiente nodo, recorrido y resultado
 *    4. Directorio .... especialistas: se descargan de internet (JSON) y se guardan en el teléfono
 *    5. Pantallas ..... el componente App y sus tres pantallas
 *    6. Estilos ....... todos los estilos en un solo StyleSheet
 *
 *  Además del código, la app usa una imagen: el logo en assets/logo-equilibra.png.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

// ============================================================================
// 1. DATOS
// Todo el texto que ve la persona. Está separado de la lógica para que sea
// fácil de revisar y de cambiar sin tocar el resto del código.
// ============================================================================

// Frase que va arriba de cada pregunta (es la misma para el GAD-7 y el PHQ-9).
const ENCABEZADO =
  'Durante las últimas 2 semanas, ¿con qué frecuencia le han molestado los siguientes problemas?';

// Las 4 respuestas posibles. "valor" son los puntos que suma cada una.
const OPCIONES = [
  { valor: 0, texto: 'Ningún día' },
  { valor: 1, texto: 'Varios días' },
  { valor: 2, texto: 'Más de la mitad de los días' },
  { valor: 3, texto: 'Casi todos los días' },
];

// Preguntas del GAD-7 (ansiedad). Cada clave (gad_1, gad_2...) es el id de su nodo en el grafo.
const PREGUNTAS_GAD7 = {
  gad_1: 'Se ha sentido nervioso(a), ansioso(a) o con los nervios de punta',
  gad_2: 'No ha sido capaz de parar o controlar su preocupación',
  gad_3: 'Se ha preocupado demasiado por motivos diferentes',
  gad_4: 'Ha tenido dificultad para relajarse',
  gad_5: 'Se ha sentido tan inquieto(a) que no ha podido quedarse quieto(a)',
  gad_6: 'Se ha molestado o irritado fácilmente',
  gad_7: 'Ha tenido miedo de que algo terrible fuera a pasar',
};

// Preguntas del PHQ-9 (depresión).
const PREGUNTAS_PHQ9 = {
  phq_1: 'Poco interés o placer en hacer las cosas',
  phq_2: 'Se ha sentido decaído(a), deprimido(a) o sin esperanzas',
  phq_3: 'Ha tenido dificultad para quedarse o permanecer dormido(a), o ha dormido demasiado',
  phq_4: 'Se ha sentido cansado(a) o con poca energía',
  phq_5: 'Sin apetito o ha comido en exceso',
  phq_6:
    'Se ha sentido mal con usted mismo(a), o que es un fracaso, o que ha quedado mal con usted mismo(a) o con su familia',
  phq_7:
    'Ha tenido dificultad para concentrarse en ciertas actividades, como leer o ver la televisión',
  phq_8:
    'Se ha movido o hablado tan lento que otras personas podrían haberlo notado, o lo contrario: ha estado muy inquieto(a) o agitado(a)',
  phq_9: 'Pensamientos de que estaría mejor muerto(a) o de lastimarse de alguna manera',
};

// Qué preguntas se suman para obtener cada puntaje.
// GAD-2 y PHQ-2 son las 2 primeras preguntas de cada cuestionario (el "tamizaje").
const ESCALAS = {
  'GAD-2': ['gad_1', 'gad_2'],
  'GAD-7': ['gad_1', 'gad_2', 'gad_3', 'gad_4', 'gad_5', 'gad_6', 'gad_7'],
  'PHQ-2': ['phq_1', 'phq_2'],
  'PHQ-9': ['phq_1', 'phq_2', 'phq_3', 'phq_4', 'phq_5', 'phq_6', 'phq_7', 'phq_8', 'phq_9'],
};

// Puntos de corte publicados: desde qué puntaje empieza cada nivel de severidad.
const CORTES = {
  'GAD-7': [
    { minimo: 0, nivel: 'mínima' },
    { minimo: 5, nivel: 'leve' },
    { minimo: 10, nivel: 'moderada' },
    { minimo: 15, nivel: 'severa' },
  ],
  'PHQ-9': [
    { minimo: 0, nivel: 'mínima' },
    { minimo: 5, nivel: 'leve' },
    { minimo: 10, nivel: 'moderada' },
    { minimo: 15, nivel: 'moderadamente severa' },
    { minimo: 20, nivel: 'severa' },
  ],
};

// Números que deciden el camino dentro del grafo.
const CORTE_TAMIZAJE = 3; // GAD-2 o PHQ-2 >= 3  ->  se completa ese cuestionario
const CORTE_RUTA = 5; // GAD-7 o PHQ-9 >= 5  ->  ruta de ansiedad o de depresión
const CORTE_ANSIEDAD_SEVERA = 15; // GAD-7 >= 15  ->  la ruta de ansiedad muestra el directorio

const RECOS_BIENESTAR = [
  'Mantén horarios regulares de sueño y comida.',
  'Haz actividad física la mayoría de los días.',
  'Dedica tiempo a convivir con personas cercanas.',
  'Repite el cuestionario en 2 semanas para dar seguimiento.',
];

const RECOS_ANSIEDAD = [
  'Respiración guiada: respira lento y alarga la exhalación durante unos minutos.',
  'Relajación muscular progresiva: tensa y suelta cada grupo de músculos, de los pies a la cara.',
  'Anclaje 5-4-3-2-1: nombra 5 cosas que ves, 4 que puedes tocar, 3 que oyes, 2 que hueles y 1 que saboreas.',
  'Higiene de sueño: horario fijo para dormir y sin pantallas antes de acostarte.',
  'Actividad física: camina o muévete unos 30 minutos la mayoría de los días.',
];

// Líneas de ayuda que aparecen primero en la ruta de crisis.
const LINEAS_CRISIS = [
  {
    nombre: 'Línea de la Vida',
    telefono: '800 911 2000',
    detalle: 'Gratuita, las 24 horas, los 365 días',
  },
  { nombre: 'Emergencias', telefono: '911', detalle: 'Si hay riesgo inmediato' },
];

// ============================================================================
// 2. EL GRAFO
//
// Un grafo es un conjunto de NODOS (puntos) unidos por ARISTAS (flechas).
// Este grafo es "dirigido": cada arista va de un nodo a otro en un solo sentido,
// como el flujo del cuestionario.
//
// Hay 3 tipos de nodo:
//   - pregunta:   una pregunta que la persona ve y contesta.
//   - evaluacion: un punto de decisión que revisa los puntajes y elige por dónde
//                 seguir. NO se muestra en pantalla porque no le pregunta nada a
//                 la persona: la app lo resuelve sola y pasa de inmediato al
//                 siguiente nodo.
//   - resultado:  el final del camino. Tiene el título, el mensaje y las
//                 recomendaciones. De un resultado no sale ninguna arista.
//
// Cada arista tiene:
//   - desde / hacia: el nodo de origen y el nodo de destino.
//   - condicion:     una función que recibe (puntajes, respuestas) y regresa true
//                    o false. La arista solo se puede usar si da true.
//   - prioridad:     el orden en que se revisan las aristas que salen de un mismo
//                    nodo (1 primero). Se usa la PRIMERA cuya condición se cumpla.
//
// Por eso cada nodo tiene, con la prioridad más baja, una arista con la condición
// "siempre": es el camino por defecto cuando ninguna otra condición se cumplió.
// ============================================================================

// Condiciones fijas: "siempre" es la del camino por defecto; "nunca" se usa en
// el resultado de bienestar para decir que no muestra el directorio.
const siempre = () => true;
const nunca = () => false;

const GRAFO = {
  inicio: 'gad_1',

  nodos: {
    // --- Nodos de pregunta ---
    gad_1: { tipo: 'pregunta', texto: PREGUNTAS_GAD7.gad_1 },
    gad_2: { tipo: 'pregunta', texto: PREGUNTAS_GAD7.gad_2 },
    gad_3: { tipo: 'pregunta', texto: PREGUNTAS_GAD7.gad_3 },
    gad_4: { tipo: 'pregunta', texto: PREGUNTAS_GAD7.gad_4 },
    gad_5: { tipo: 'pregunta', texto: PREGUNTAS_GAD7.gad_5 },
    gad_6: { tipo: 'pregunta', texto: PREGUNTAS_GAD7.gad_6 },
    gad_7: { tipo: 'pregunta', texto: PREGUNTAS_GAD7.gad_7 },
    phq_1: { tipo: 'pregunta', texto: PREGUNTAS_PHQ9.phq_1 },
    phq_2: { tipo: 'pregunta', texto: PREGUNTAS_PHQ9.phq_2 },
    phq_3: { tipo: 'pregunta', texto: PREGUNTAS_PHQ9.phq_3 },
    phq_4: { tipo: 'pregunta', texto: PREGUNTAS_PHQ9.phq_4 },
    phq_5: { tipo: 'pregunta', texto: PREGUNTAS_PHQ9.phq_5 },
    phq_6: { tipo: 'pregunta', texto: PREGUNTAS_PHQ9.phq_6 },
    phq_7: { tipo: 'pregunta', texto: PREGUNTAS_PHQ9.phq_7 },
    phq_8: { tipo: 'pregunta', texto: PREGUNTAS_PHQ9.phq_8 },
    phq_9: { tipo: 'pregunta', texto: PREGUNTAS_PHQ9.phq_9 },

    // --- Nodos de evaluación (nunca se muestran) ---
    eval_tamizaje: {
      tipo: 'evaluacion',
      descripcion: 'Revisa GAD-2 y PHQ-2 para decidir qué cuestionario completar',
    },
    eval_post_gad: {
      tipo: 'evaluacion',
      descripcion: 'Al terminar el GAD-7, decide si sigue el PHQ-9',
    },
    eval_final: {
      tipo: 'evaluacion',
      descripcion: 'Asigna la ruta final por prioridad',
    },

    // --- Nodos de resultado ---
    // Todos tienen los mismos campos para que la pantalla de resultado no tenga
    // que revisar si existen. "mostrarDirectorio" también es una condición:
    // decide si aparece la lista de especialistas.
    // "recomendacionesCondicionales" son recomendaciones que solo se agregan si
    // su condición se cumple.
    res_bienestar: {
      tipo: 'resultado',
      ruta: 'bienestar',
      titulo: 'Bienestar estable',
      mensaje: 'No se detectaron señales importantes de ansiedad o depresión.',
      lineasCrisis: [],
      recomendaciones: RECOS_BIENESTAR,
      recomendacionesCondicionales: [],
      mostrarDirectorio: nunca,
    },
    res_ansiedad: {
      tipo: 'resultado',
      ruta: 'ansiedad',
      titulo: 'Señales de ansiedad',
      mensaje:
        'Tus respuestas muestran señales de ansiedad. Estas técnicas pueden ayudarte a bajar esos niveles.',
      lineasCrisis: [],
      recomendaciones: RECOS_ANSIEDAD,
      recomendacionesCondicionales: [],
      mostrarDirectorio: (puntajes) => puntajes['GAD-7'] >= CORTE_ANSIEDAD_SEVERA,
    },
    res_depresion: {
      tipo: 'resultado',
      ruta: 'depresion',
      titulo: 'Señales de depresión',
      mensaje:
        'Tus respuestas muestran señales de depresión o de riesgo de desarrollarla. Te recomendamos hablar con un especialista.',
      lineasCrisis: [],
      recomendaciones: [],
      recomendacionesCondicionales: [
        // Si además hay ansiedad (GAD-7 >= 5), se agregan las técnicas de ansiedad.
        { condicion: (puntajes) => puntajes['GAD-7'] >= CORTE_RUTA, items: RECOS_ANSIEDAD },
      ],
      mostrarDirectorio: siempre,
    },
    res_crisis: {
      tipo: 'resultado',
      ruta: 'crisis',
      titulo: 'Busca apoyo ahora',
      mensaje:
        'Una de tus respuestas indica que podrías necesitar apoyo ahora mismo. Hablar con alguien puede ayudar: estas líneas son gratuitas y atienden a cualquier hora.',
      lineasCrisis: LINEAS_CRISIS,
      recomendaciones: [],
      recomendacionesCondicionales: [],
      mostrarDirectorio: siempre,
    },
  },

  aristas: [
    // Tamizaje: las primeras 4 preguntas van en fila, siempre.
    { desde: 'gad_1', hacia: 'gad_2', prioridad: 1, condicion: siempre },
    { desde: 'gad_2', hacia: 'phq_1', prioridad: 1, condicion: siempre },
    { desde: 'phq_1', hacia: 'phq_2', prioridad: 1, condicion: siempre },
    { desde: 'phq_2', hacia: 'eval_tamizaje', prioridad: 1, condicion: siempre },

    // Evaluación del tamizaje: primero se revisa la ansiedad, luego la depresión.
    // Si ninguna salió alta, se salta directo a la evaluación final.
    { desde: 'eval_tamizaje', hacia: 'gad_3', prioridad: 1, condicion: (puntajes) => puntajes['GAD-2'] >= CORTE_TAMIZAJE },
    { desde: 'eval_tamizaje', hacia: 'phq_3', prioridad: 2, condicion: (puntajes) => puntajes['PHQ-2'] >= CORTE_TAMIZAJE },
    { desde: 'eval_tamizaje', hacia: 'eval_final', prioridad: 3, condicion: siempre },

    // Resto del GAD-7 (gad_3 a gad_7).
    { desde: 'gad_3', hacia: 'gad_4', prioridad: 1, condicion: siempre },
    { desde: 'gad_4', hacia: 'gad_5', prioridad: 1, condicion: siempre },
    { desde: 'gad_5', hacia: 'gad_6', prioridad: 1, condicion: siempre },
    { desde: 'gad_6', hacia: 'gad_7', prioridad: 1, condicion: siempre },
    { desde: 'gad_7', hacia: 'eval_post_gad', prioridad: 1, condicion: siempre },

    // Al terminar el GAD-7: si el PHQ-2 también salió alto, sigue el resto del PHQ-9.
    { desde: 'eval_post_gad', hacia: 'phq_3', prioridad: 1, condicion: (puntajes) => puntajes['PHQ-2'] >= CORTE_TAMIZAJE },
    { desde: 'eval_post_gad', hacia: 'eval_final', prioridad: 2, condicion: siempre },

    // Resto del PHQ-9 (phq_3 a phq_9).
    { desde: 'phq_3', hacia: 'phq_4', prioridad: 1, condicion: siempre },
    { desde: 'phq_4', hacia: 'phq_5', prioridad: 1, condicion: siempre },
    { desde: 'phq_5', hacia: 'phq_6', prioridad: 1, condicion: siempre },
    { desde: 'phq_6', hacia: 'phq_7', prioridad: 1, condicion: siempre },
    { desde: 'phq_7', hacia: 'phq_8', prioridad: 1, condicion: siempre },
    { desde: 'phq_8', hacia: 'phq_9', prioridad: 1, condicion: siempre },

    // phq_9 pregunta por pensamientos de hacerse daño: cualquier respuesta
    // distinta de "Ningún día" lleva directo a la ruta de crisis.
    { desde: 'phq_9', hacia: 'res_crisis', prioridad: 1, condicion: (puntajes, respuestas) => respuestas.phq_9 >= 1 },
    { desde: 'phq_9', hacia: 'eval_final', prioridad: 2, condicion: siempre },

    // Evaluación final: la depresión tiene prioridad sobre la ansiedad.
    { desde: 'eval_final', hacia: 'res_depresion', prioridad: 1, condicion: (puntajes) => puntajes['PHQ-9'] >= CORTE_RUTA },
    { desde: 'eval_final', hacia: 'res_ansiedad', prioridad: 2, condicion: (puntajes) => puntajes['GAD-7'] >= CORTE_RUTA },
    { desde: 'eval_final', hacia: 'res_bienestar', prioridad: 3, condicion: siempre },
  ],
};

// ============================================================================
// 3. FUNCIONES DE LÓGICA
// Reciben datos y regresan un valor, sin tocar la pantalla. Son el equivalente
// en JavaScript de las funciones del archivo Python.
// "respuestas" siempre es un objeto como { gad_1: 2, gad_2: 0, ... }.
// ============================================================================

// Suma los puntos de cada escala. Las preguntas sin contestar valen 0.
// Ejemplo: { gad_1: 2, gad_2: 1 }  ->  { 'GAD-2': 3, 'GAD-7': 3, 'PHQ-2': 0, 'PHQ-9': 0 }
function calcularPuntajes(respuestas) {
  const puntajes = {};
  for (const escala of Object.keys(ESCALAS)) {
    let suma = 0;
    for (const id of ESCALAS[escala]) {
      if (respuestas[id] !== undefined) {
        suma = suma + respuestas[id];
      }
    }
    puntajes[escala] = suma;
  }
  return puntajes;
}

// Traduce un puntaje a su nivel de severidad con los puntos de corte.
// Recorre los cortes de menor a mayor y se queda con el último que alcanza.
// Ejemplo: GAD-7 = 12  ->  alcanza 0, 5 y 10, pero no 15  ->  'moderada'.
function nivelDeSeveridad(escala, valor) {
  let nivel = CORTES[escala][0].nivel;
  for (const corte of CORTES[escala]) {
    if (valor >= corte.minimo) {
      nivel = corte.nivel;
    }
  }
  return nivel;
}

// Decide a qué nodo se pasa desde "nodo":
//   1) Toma las aristas que salen de ese nodo.
//   2) Las ordena por prioridad (1, 2, 3...).
//   3) Regresa el destino de la primera cuya condición se cumple.
function siguienteNodo(nodo, respuestas) {
  const puntajes = calcularPuntajes(respuestas);
  const salidas = GRAFO.aristas.filter((arista) => arista.desde === nodo);
  salidas.sort((a, b) => a.prioridad - b.prioridad);

  for (const arista of salidas) {
    if (arista.condicion(puntajes, respuestas)) {
      return arista.hacia;
    }
  }
  // No debería pasar nunca: cada nodo tiene una arista "siempre" al final.
  throw new Error('Ninguna arista válida desde ' + nodo);
}

// Recorre el grafo desde el inicio con las respuestas que hay hasta ahora y
// regresa el nodo donde se detiene:
//   - una pregunta que todavía no tiene respuesta (la que toca mostrar), o
//   - un resultado (el cuestionario terminó).
// Los nodos de evaluación nunca detienen el recorrido: se resuelven solos con
// siguienteNodo, y por eso la persona nunca los ve.
//
// Como siempre empieza desde el inicio, "regresar" es muy sencillo: basta con
// borrar la última respuesta y volver a recorrer. No hay que guardar el camino.
function recorrerGrafo(respuestas) {
  let nodo = GRAFO.inicio;
  while (true) {
    const tipo = GRAFO.nodos[nodo].tipo;
    if (tipo === 'resultado') {
      return nodo;
    }
    if (tipo === 'pregunta' && respuestas[nodo] === undefined) {
      return nodo;
    }
    nodo = siguienteNodo(nodo, respuestas);
  }
}

// Cuántas preguntas pueden faltar, en el peor caso, contando desde "nodo".
// Sirve para el texto "Pregunta X de hasta Y" y para la barra de avance.
// Es recursiva: se llama a sí misma con cada nodo siguiente y se queda con el
// camino más largo. Termina porque el grafo no tiene ciclos.
function maximoPreguntasRestantes(nodo) {
  let propio = 0;
  if (GRAFO.nodos[nodo].tipo === 'pregunta') {
    propio = 1;
  }

  let mayor = 0;
  for (const arista of GRAFO.aristas) {
    if (arista.desde === nodo) {
      mayor = Math.max(mayor, maximoPreguntasRestantes(arista.hacia));
    }
  }
  return propio + mayor;
}

// true si todas las preguntas de esa escala tienen respuesta.
function instrumentoCompleto(escala, respuestas) {
  return ESCALAS[escala].every((id) => respuestas[id] !== undefined);
}

// Arma una fila de "Tus puntajes". Si el cuestionario completo no se aplicó,
// se muestra el puntaje del tamizaje (de 6) con la etiqueta "tamizaje sin señales".
// Cada pregunta vale como máximo 3 puntos, por eso el máximo es 3 × preguntas.
function filaDePuntaje(tema, escalaCompleta, escalaTamizaje, respuestas) {
  const puntajes = calcularPuntajes(respuestas);

  if (instrumentoCompleto(escalaCompleta, respuestas)) {
    return {
      tema: tema,
      escala: escalaCompleta,
      valor: puntajes[escalaCompleta],
      maximo: 3 * ESCALAS[escalaCompleta].length,
      nivel: 'nivel ' + nivelDeSeveridad(escalaCompleta, puntajes[escalaCompleta]),
    };
  }
  return {
    tema: tema,
    escala: escalaTamizaje,
    valor: puntajes[escalaTamizaje],
    maximo: 3 * ESCALAS[escalaTamizaje].length,
    nivel: 'tamizaje sin señales',
  };
}

// Junta todo lo que se muestra en la pantalla de resultado: los textos del nodo
// de resultado, las recomendaciones (más las condicionales que apliquen), si se
// muestra el directorio y los puntajes.
function armarResultado(respuestas) {
  const datos = GRAFO.nodos[recorrerGrafo(respuestas)];
  const puntajes = calcularPuntajes(respuestas);

  let recomendaciones = datos.recomendaciones;
  for (const extra of datos.recomendacionesCondicionales) {
    if (extra.condicion(puntajes, respuestas)) {
      recomendaciones = recomendaciones.concat(extra.items);
    }
  }

  return {
    ruta: datos.ruta,
    titulo: datos.titulo,
    mensaje: datos.mensaje,
    lineasCrisis: datos.lineasCrisis,
    recomendaciones: recomendaciones,
    mostrarDirectorio: datos.mostrarDirectorio(puntajes, respuestas),
    puntajes: [
      filaDePuntaje('Ansiedad', 'GAD-7', 'GAD-2', respuestas),
      filaDePuntaje('Depresión', 'PHQ-9', 'PHQ-2', respuestas),
    ],
  };
}

// ============================================================================
// 4. DIRECTORIO DE ESPECIALISTAS (se descarga de internet y se guarda en el teléfono)
//
// La lista de especialistas NO está escrita en el código: es un archivo JSON
// publicado en internet (el "endpoint"). Así el equipo puede actualizarla sin
// volver a publicar la app. El archivo es endpoint/especialistas.json del
// repositorio de GitHub y tiene esta forma:
//
//   {
//     "timestamp": "2026-11-13T12:00:00Z",  <- fecha y hora de esta versión
//     "datosDePrueba": true,                <- muestra la etiqueta "Datos de prueba"
//     "especialistas": [
//       { "nombre": "...", "especialidad": "...", "telefono": "...", "cedula": "..." }
//     ]
//   }
//
// Qué pasa cada vez que se abre la app:
//   1. Lee la copia guardada en el teléfono (si existe) y la usa de inmediato.
//      Por eso el directorio funciona sin internet.
//   2. Consulta el endpoint para ver qué versión tiene publicada:
//      - La primera vez no hay copia local, así que se guarda lo descargado.
//      - Si el timestamp del endpoint es más nuevo que el de la copia local,
//        la copia local se reemplaza por la versión nueva.
//      - Si el timestamp es igual o más viejo, la copia local se queda igual.
//      - Si no hay internet, no pasa nada: se sigue usando la copia local.
//   Para conocer el timestamp del endpoint hay que pedirle el archivo; como es
//   pequeño, en esa misma consulta llega la versión completa.
//
// La copia local se guarda con AsyncStorage: una pequeña base de datos del
// teléfono que guarda textos bajo un nombre (llave). Lo guardado sigue ahí
// aunque se cierre la app.
//
// Estas funciones son "async" porque hacen tareas que tardan (leer la memoria
// del teléfono o descargar de internet). "await" espera a que terminen.
//
// ¡OJO! Por ahora el JSON tiene DATOS DE PRUEBA: los nombres son de los
// integrantes del equipo y los teléfonos y cédulas son inventados. Los teléfonos
// tienen a propósito la forma 55 0000 000X para que el botón "Llamar" no le
// marque a un desconocido. El equipo los reemplazará con especialistas reales,
// verificados en el Registro Nacional de Profesionistas. Para publicar una
// versión nueva basta con editar el JSON, poner un timestamp más reciente y
// cambiar "datosDePrueba" a false.
// ============================================================================

// Dirección del endpoint: el archivo JSON "crudo" (raw) del repositorio de GitHub.
const URL_DIRECTORIO =
  'https://raw.githubusercontent.com/carger74/PF_AppMov_Spetznas/main/endpoint/especialistas.json';

// Nombre (llave) con el que se guarda la copia local en AsyncStorage.
const LLAVE_DIRECTORIO = 'directorio-especialistas';

// Revisa que el JSON tenga lo necesario: un timestamp y una lista de especialistas.
// Así, si el endpoint regresara algo roto, no se guarda.
function esDirectorioValido(datos) {
  return Boolean(datos && datos.timestamp && Array.isArray(datos.especialistas));
}

// true si "nuevo" tiene un timestamp más reciente que "actual".
// new Date(...) convierte el texto del timestamp en una fecha que se puede comparar.
function esMasNuevo(nuevo, actual) {
  return new Date(nuevo.timestamp) > new Date(actual.timestamp);
}

// Lee la copia guardada en el teléfono. Regresa null si nunca se ha descargado.
// AsyncStorage solo guarda texto, por eso se convierte de vuelta con JSON.parse.
async function leerDirectorioLocal() {
  try {
    const texto = await AsyncStorage.getItem(LLAVE_DIRECTORIO);
    if (texto === null) {
      return null;
    }
    return JSON.parse(texto);
  } catch (error) {
    return null; // la copia local no se pudo leer: se tratará como si no existiera
  }
}

// Guarda una copia en el teléfono, convertida a texto con JSON.stringify.
async function guardarDirectorioLocal(directorio) {
  await AsyncStorage.setItem(LLAVE_DIRECTORIO, JSON.stringify(directorio));
}

// Descarga el JSON del endpoint con fetch. Regresa null si no hay internet, si
// el servidor responde con un error o si el JSON no tiene la forma esperada.
// try / catch atrapa el error que lanza fetch cuando no hay conexión.
async function descargarDirectorio() {
  try {
    const respuesta = await fetch(URL_DIRECTORIO);
    if (!respuesta.ok) {
      return null;
    }
    const datos = await respuesta.json();
    if (!esDirectorioValido(datos)) {
      return null;
    }
    return datos;
  } catch (error) {
    return null;
  }
}

// Junta los pasos de arriba. Cada vez que hay una versión lista para mostrarse
// llama a alCargar(directorio): primero con la copia local (si existe) y luego
// con la descargada, solo si es más nueva.
async function cargarDirectorio(alCargar) {
  const local = await leerDirectorioLocal();
  if (local !== null) {
    alCargar(local);
  }

  const remoto = await descargarDirectorio();
  if (remoto === null) {
    return; // sin internet: se queda la copia local
  }

  if (local === null || esMasNuevo(remoto, local)) {
    await guardarDirectorioLocal(remoto);
    alCargar(remoto);
  }
}

// ============================================================================
// 5. PANTALLAS
// App es el componente principal: guarda el estado (en qué pantalla estamos y
// qué ha contestado la persona) y decide cuál de las tres pantallas dibujar.
// Las pantallas son componentes más pequeños que reciben datos y funciones por
// "props" (los atributos que se le pasan a un componente, como en
// <Boton texto="Comenzar" />).
// ============================================================================

export default function App() {
  // useState crea una variable que React "recuerda" mientras la app está abierta.
  // Regresa dos cosas: el valor actual y una función para cambiarlo.
  // Cada vez que se llama a esa función, React vuelve a dibujar la pantalla con
  // el valor nuevo. Con una variable normal (let) la pantalla no se actualizaría.
  const [pantalla, setPantalla] = useState('bienvenida'); // 'bienvenida' | 'pregunta' | 'resultado'
  const [respuestas, setRespuestas] = useState({}); // { gad_1: 2, gad_2: 0, ... }
  const [historial, setHistorial] = useState([]); // ids de las preguntas contestadas, en orden
  // Respuestas que se borraron al presionar "Regresar". No cuentan para los
  // puntajes ni para el grafo: solo sirven para marcar en pantalla lo que la
  // persona había elegido cuando vuelve a ver esa pregunta.
  const [recordadas, setRecordadas] = useState({});
  // Directorio de especialistas: null hasta que se carga (de la copia local o de internet).
  const [directorio, setDirectorio] = useState(null);

  // useEffect ejecuta código DESPUÉS de dibujar la pantalla. El [] del final
  // indica que solo se ejecute una vez, al abrir la app: es el momento de
  // cargar el directorio y revisar si hay una versión nueva.
  useEffect(() => {
    cargarDirectorio(setDirectorio);
  }, []);

  // El nodo actual NO se guarda en el estado: se calcula recorriendo el grafo.
  const nodoActual = recorrerGrafo(respuestas);

  // Empieza el cuestionario desde cero.
  function comenzar() {
    setRespuestas({});
    setHistorial([]);
    setRecordadas({});
    setPantalla('pregunta');
  }

  // Guarda la respuesta de la pregunta actual. Si con eso el recorrido llega a un
  // resultado, cambia a la pantalla de resultado.
  // Se hacen copias ({ ...respuestas } y [...historial]) porque React solo nota
  // el cambio si recibe un objeto nuevo, no el mismo objeto modificado.
  function responder(valor) {
    const nuevasRespuestas = { ...respuestas };
    nuevasRespuestas[nodoActual] = valor;
    setRespuestas(nuevasRespuestas);
    setHistorial([...historial, nodoActual]);

    const siguiente = recorrerGrafo(nuevasRespuestas);
    if (GRAFO.nodos[siguiente].tipo === 'resultado') {
      setPantalla('resultado');
    }
  }

  // Borra la última respuesta. Al volver a recorrer el grafo, la pregunta actual
  // vuelve a ser esa. slice(0, -1) copia el historial sin su último elemento.
  // Antes de borrarla la guardamos en "recordadas", para que la opción que había
  // elegido aparezca marcada.
  function regresar() {
    const ultima = historial[historial.length - 1];

    const nuevasRecordadas = { ...recordadas };
    nuevasRecordadas[ultima] = respuestas[ultima];
    setRecordadas(nuevasRecordadas);

    const nuevasRespuestas = { ...respuestas };
    delete nuevasRespuestas[ultima];
    setRespuestas(nuevasRespuestas);
    setHistorial(historial.slice(0, -1));
  }

  // Cancela el cuestionario y vuelve a la bienvenida.
  function salir() {
    setRespuestas({});
    setHistorial([]);
    setRecordadas({});
    setPantalla('bienvenida');
  }

  // Elegimos qué pantalla dibujar según la variable "pantalla".
  let contenido;
  if (pantalla === 'bienvenida') {
    contenido = <PantallaBienvenida alComenzar={comenzar} />;
  } else if (pantalla === 'pregunta') {
    contenido = (
      <PantallaPregunta
        nodo={nodoActual}
        contestadas={historial.length}
        recordada={recordadas[nodoActual]}
        alResponder={responder}
        alRegresar={regresar}
        alSalir={salir}
      />
    );
  } else {
    contenido = (
      <PantallaResultado
        resultado={armarResultado(respuestas)}
        directorio={directorio}
        alReiniciar={comenzar}
      />
    );
  }

  // SafeAreaView evita que el contenido quede debajo del "notch" en iPhone.
  // En Android no hace nada, por eso el estilo "fondo" deja el espacio de la
  // barra de estado (ver la sección de estilos).
  return <SafeAreaView style={estilos.fondo}>{contenido}</SafeAreaView>;
}

// Botón reutilizable. Pressable no trae estilo propio, así que se lo pasamos.
// En "style" usamos una función que recibe { pressed }: pressed es true mientras
// el dedo está encima, y lo usamos para que el botón se vea presionado.
function Boton({ texto, alPresionar, estilo, estiloTexto, desactivado }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={alPresionar}
      disabled={desactivado}
      style={({ pressed }) => [estilo, pressed && estilos.presionado, desactivado && estilos.desactivado]}
    >
      <Text style={estiloTexto}>{texto}</Text>
    </Pressable>
  );
}

// Abre la app de teléfono del celular con el número ya marcado.
// "tel:" le indica al sistema que es un teléfono; antes se quitan los espacios.
function llamar(telefono) {
  Linking.openURL('tel:' + telefono.replaceAll(' ', ''));
}

// ---------------------------------------------------------------------------
// Pantalla 1: Bienvenida
// ---------------------------------------------------------------------------
// El logo se ajusta al tamaño de cada teléfono: useWindowDimensions da el ancho
// y el alto de la pantalla (y se actualiza si se gira el celular). El logo mide
// la mitad del ancho, pero nunca más de una cuarta parte del alto, para que en
// pantallas chicas quede espacio para el texto. El alto se calcula con la
// proporción de la imagen original (332 × 370) para que no se deforme.
function PantallaBienvenida({ alComenzar }) {
  const pantallaTelefono = useWindowDimensions();
  const anchoLogo = Math.min(pantallaTelefono.width * 0.5, pantallaTelefono.height * 0.25);
  const altoLogo = anchoLogo * (370 / 332);

  return (
    <ScrollView contentContainerStyle={[estilos.contenido, estilos.centrado]}>
      {/* require() mete la imagen dentro de la app, así se ve aunque no haya internet. */}
      <Image
        source={require('./assets/logo-equilibra.png')}
        resizeMode="contain"
        style={[estilos.logo, { width: anchoLogo, height: altoLogo }]}
      />
      <Text style={estilos.nombreApp}>Equilibra</Text>
      <Text style={estilos.subtituloApp}>
        Un cuestionario adaptativo que evalúa tu bienestar emocional y te indica el siguiente paso
      </Text>

      <View style={estilos.tarjeta}>
        {/* 4 preguntas si el tamizaje sale sin señales; 16 si se completan ambos cuestionarios */}
        <Text style={estilos.parrafo}>
          Contestarás entre 4 y 16 preguntas sobre cómo te has sentido en las últimas 2 semanas.
          Toma de 2 a 5 minutos.
        </Text>
        <Text style={estilos.parrafo}>
          Este cuestionario no es un diagnóstico: te orienta sobre el siguiente paso.
        </Text>
        <Text style={estilos.parrafo}>Tus respuestas no se guardan.</Text>
      </View>

      <Boton
        texto="Comenzar"
        alPresionar={alComenzar}
        estilo={estilos.botonPrincipal}
        estiloTexto={estilos.botonPrincipalTexto}
      />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Pantalla 2: Pregunta
// Muestra la pregunta del nodo actual con sus 4 opciones. Al tocar una opción,
// primero se marca (en verde y con ✓) para que la persona vea lo que eligió;
// después de una pausa corta se llama a alResponder y la app avanza sola.
// Si la persona regresó a esta pregunta, "recordada" trae lo que había elegido
// y esa opción aparece marcada desde el inicio.
// OPCIONES.map(...) crea un botón por cada opción; "key" le ayuda a React a
// distinguir los elementos de una lista.
//
// Para llenar bien la pantalla de cualquier teléfono:
//   - La barra de avance va arriba y los botones Regresar/Salir abajo. La
//     pregunta con sus opciones queda centrada entre ellos gracias a dos
//     espacios flexibles que se reparten lo que sobre de la pantalla.
//   - El tamaño de la letra y el alto de las opciones se calculan con las
//     medidas de la pantalla (useWindowDimensions). Math.max pone un mínimo y
//     Math.min un máximo, para que no queden ni muy chicos ni muy grandes.
// ---------------------------------------------------------------------------

// Cuánto tiempo (en milisegundos) se ve marcada la opción antes de avanzar.
const PAUSA_AL_ELEGIR = 400;

function PantallaPregunta({ nodo, contestadas, recordada, alResponder, alRegresar, alSalir }) {
  // Un componente también puede tener su propio estado. "seleccion" guarda el
  // valor de la opción recién tocada (null = todavía no ha tocado ninguna).
  const [seleccion, setSeleccion] = useState(null);
  const esperando = seleccion !== null;

  // La opción marcada es la que acaba de tocar o, si no ha tocado ninguna, la
  // que había elegido antes de regresar (undefined si no hay ninguna).
  let marcada = recordada;
  if (esperando) {
    marcada = seleccion;
  }

  const numero = contestadas + 1;
  const total = contestadas + maximoPreguntasRestantes(nodo);
  const avance = (numero / total) * 100;

  // Tamaños según la pantalla. Ejemplos:
  //   iPhone 17 Pro Max (440 × 956): letra 24, opciones de 76 de alto
  //   iPhone SE         (375 × 667): letra 21, opciones de 56 de alto
  const pantallaTelefono = useWindowDimensions();
  const letraPregunta = Math.round(Math.min(Math.max(pantallaTelefono.width / 18, 20), 26));
  const letraOpcion = Math.round(letraPregunta * 0.85);
  const altoOpcion = Math.round(Math.min(Math.max(pantallaTelefono.height * 0.08, 56), 84));

  // Marca la opción y, terminada la pausa, guarda la respuesta.
  // setTimeout ejecuta una función después de cierto tiempo.
  // Mientras se espera, los demás botones no responden, para no contestar dos veces.
  function elegir(valor) {
    if (esperando) {
      return;
    }
    setSeleccion(valor);
    setTimeout(() => {
      setSeleccion(null);
      alResponder(valor);
    }, PAUSA_AL_ELEGIR);
  }

  return (
    <ScrollView contentContainerStyle={estilos.contenido}>
      <Text style={estilos.contador}>
        Pregunta {numero} de hasta {total}
      </Text>
      <View style={estilos.barraFondo}>
        <View style={[estilos.barraRelleno, { width: avance + '%' }]} />
      </View>

      {/* Espacio flexible de arriba: junto con el de abajo, centra la pregunta */}
      <View style={estilos.espacioFlexible} />

      <Text style={estilos.encabezado}>{ENCABEZADO}</Text>
      <Text
        style={[estilos.pregunta, { fontSize: letraPregunta, lineHeight: letraPregunta * 1.35 }]}
      >
        {GRAFO.nodos[nodo].texto}
      </Text>

      {recordada !== undefined && !esperando && (
        <Text style={estilos.notaRecordada}>
          Tu respuesta anterior está marcada. Tócala para seguir o elige otra.
        </Text>
      )}

      {/* La opción marcada suma su estilo "Elegida"; mientras se espera, las demás se ven apagadas.
          "condicion ? a : b" vale a si la condición se cumple y b si no. */}
      {OPCIONES.map((opcion) => {
        const elegida = opcion.valor === marcada;
        return (
          <Boton
            key={opcion.valor}
            texto={elegida ? '✓  ' + opcion.texto : opcion.texto}
            alPresionar={() => elegir(opcion.valor)}
            desactivado={esperando && !elegida}
            estilo={[estilos.opcion, { minHeight: altoOpcion }, elegida && estilos.opcionElegida]}
            estiloTexto={[
              estilos.opcionTexto,
              { fontSize: letraOpcion },
              elegida && estilos.opcionTextoElegida,
            ]}
          />
        );
      })}

      {/* Espacio flexible de abajo: empuja Regresar y Salir hasta el final de la pantalla */}
      <View style={estilos.espacioFlexible} />

      <View style={estilos.filaNavegacion}>
        <Boton
          texto="Regresar"
          alPresionar={alRegresar}
          desactivado={contestadas === 0 || esperando}
          estilo={estilos.botonSecundario}
          estiloTexto={estilos.botonSecundarioTexto}
        />
        <Boton
          texto="Salir"
          alPresionar={alSalir}
          desactivado={esperando}
          estilo={estilos.botonSecundario}
          estiloTexto={estilos.botonSecundarioTexto}
        />
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Pantalla 3: Resultado
// Usa ScrollView porque puede ser larga. Las partes que no siempre aplican se
// escriben como {condicion && <...>}: si la condición es false, no se dibuja nada.
// ---------------------------------------------------------------------------
function PantallaResultado({ resultado, directorio, alReiniciar }) {
  const esCrisis = resultado.ruta === 'crisis';

  return (
    <ScrollView contentContainerStyle={estilos.contenido}>
      <Text style={[estilos.tituloResultado, esCrisis && estilos.textoCrisis]}>
        {resultado.titulo}
      </Text>
      <Text style={estilos.parrafo}>{resultado.mensaje}</Text>

      {/* Líneas de crisis: solo la ruta de crisis las tiene, y van primero */}
      {resultado.lineasCrisis.map((linea) => (
        <View key={linea.telefono} style={estilos.tarjetaCrisis}>
          <Text style={estilos.tarjetaTitulo}>{linea.nombre}</Text>
          <Text style={estilos.telefonoCrisis}>{linea.telefono}</Text>
          <Text style={estilos.textoSecundario}>{linea.detalle}</Text>
          <Boton
            texto="Llamar"
            alPresionar={() => llamar(linea.telefono)}
            estilo={estilos.botonCrisis}
            estiloTexto={estilos.botonPrincipalTexto}
          />
        </View>
      ))}

      {resultado.recomendaciones.length > 0 && (
        <View style={estilos.seccion}>
          <Text style={estilos.subtitulo}>Recomendaciones para ti</Text>
          {resultado.recomendaciones.map((recomendacion) => (
            <Text key={recomendacion} style={estilos.vineta}>
              • {recomendacion}
            </Text>
          ))}
        </View>
      )}

      {resultado.mostrarDirectorio && <SeccionDirectorio directorio={directorio} />}

      <View style={estilos.seccion}>
        <Text style={estilos.subtitulo}>Tus puntajes</Text>
        {resultado.puntajes.map((fila) => (
          <View key={fila.escala} style={estilos.filaPuntaje}>
            <Text style={estilos.puntajeTema}>
              {fila.tema} ({fila.escala})
            </Text>
            <Text style={estilos.textoSecundario}>
              {fila.valor} de {fila.maximo} · {fila.nivel}
            </Text>
          </View>
        ))}
      </View>

      <Text style={estilos.recordatorio}>Recuerda: este resultado no es un diagnóstico.</Text>
      {!esCrisis && (
        <Text style={estilos.notaPequena}>
          Si en algún momento necesitas hablar con alguien, la Línea de la Vida (800 911 2000)
          atiende gratis las 24 horas.
        </Text>
      )}

      <Boton
        texto="Contestar de nuevo"
        alPresionar={alReiniciar}
        estilo={estilos.botonPrincipal}
        estiloTexto={estilos.botonPrincipalTexto}
      />
    </ScrollView>
  );
}

// Sección "Especialistas recomendados": una tarjeta por persona del directorio
// descargado. Si todavía no hay copia en el teléfono (la primera vez sin
// internet), se muestra un aviso en lugar de la lista.
function SeccionDirectorio({ directorio }) {
  if (directorio === null) {
    return (
      <View style={estilos.seccion}>
        <Text style={estilos.subtitulo}>Especialistas recomendados</Text>
        <Text style={estilos.parrafo}>Te sugerimos hablar con un especialista.</Text>
        <View style={estilos.tarjeta}>
          <Text style={estilos.dato}>
            El directorio de especialistas todavía no se ha descargado. Conéctate a internet y
            vuelve a abrir la app; después funcionará sin conexión.
          </Text>
        </View>
      </View>
    );
  }

  // toLocaleDateString('es-MX') escribe la fecha del timestamp como 13/11/2026.
  const fechaActualizacion = new Date(directorio.timestamp).toLocaleDateString('es-MX');

  return (
    <View style={estilos.seccion}>
      {directorio.datosDePrueba && <Text style={estilos.etiquetaPrueba}>Datos de prueba</Text>}
      <Text style={estilos.subtitulo}>Especialistas recomendados</Text>
      <Text style={estilos.parrafo}>Te sugerimos hablar con un especialista.</Text>

      {directorio.especialistas.map((persona) => (
        <View key={persona.cedula} style={estilos.tarjeta}>
          <Text style={estilos.tarjetaTitulo}>{persona.nombre}</Text>
          <Text style={estilos.textoSecundario}>{persona.especialidad}</Text>
          <Text style={estilos.dato}>Teléfono: {persona.telefono}</Text>
          <Text style={estilos.dato}>Cédula profesional: {persona.cedula}</Text>
          <Boton
            texto="Llamar"
            alPresionar={() => llamar(persona.telefono)}
            estilo={estilos.botonLlamar}
            estiloTexto={estilos.botonPrincipalTexto}
          />
        </View>
      ))}

      <Text style={estilos.notaPequena}>Directorio actualizado el {fechaActualizacion}</Text>
    </View>
  );
}

// ============================================================================
// 6. ESTILOS
// Paleta tranquila: fondo claro, verde salvia y azul suave.
// El rojo/coral solo se usa en la ruta de crisis.
// ============================================================================

const COLORES = {
  fondo: '#F4F7F3',
  blanco: '#FFFFFF',
  texto: '#26332C',
  textoSuave: '#5C6B63',
  indigo: '#505692', // el mismo color del logo
  salvia: '#4F7A5C',
  salviaClaro: '#E3EDE5',
  azulClaro: '#E7EFF8',
  bordeAzul: '#C9D9EA',
  borde: '#D5DED8',
  coral: '#B5483B',
  coralClaro: '#FBEAE6',
  amarilloClaro: '#FFF1C9',
  amarilloTexto: '#7A5A00',
};

const estilos = StyleSheet.create({
  // StatusBar.currentHeight es la altura de la barra de estado en Android
  // (en iPhone no existe y no agrega nada, ahí se encarga SafeAreaView).
  fondo: {
    flex: 1,
    backgroundColor: COLORES.fondo,
    paddingTop: StatusBar.currentHeight,
  },
  // El contenido ocupa todo el ancho del teléfono. En pantallas grandes
  // (tablets) no pasa de 600 de ancho y queda centrado, para que se lea bien.
  contenido: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    padding: 20,
    paddingBottom: 48,
  },
  centrado: {
    justifyContent: 'center',
  },

  // --- Bienvenida ---
  // El ancho y el alto del logo se calculan en PantallaBienvenida según la pantalla.
  logo: {
    alignSelf: 'center',
    marginBottom: 12,
  },
  nombreApp: {
    fontSize: 42,
    fontWeight: 'bold',
    color: COLORES.indigo,
    textAlign: 'center',
  },

  subtituloApp: {
    fontSize: 18,
    lineHeight: 26,
    color: COLORES.textoSuave,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 28,
  },

  // --- Textos generales ---
  parrafo: {
    fontSize: 16,
    lineHeight: 24,
    color: COLORES.texto,
    marginBottom: 12,
  },
  subtitulo: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORES.texto,
    marginBottom: 12,
  },
  textoSecundario: {
    fontSize: 15,
    color: COLORES.textoSuave,
  },
  dato: {
    fontSize: 15,
    color: COLORES.texto,
    marginTop: 4,
  },

  // --- Pantalla de pregunta ---
  contador: {
    fontSize: 14,
    color: COLORES.textoSuave,
    marginBottom: 8,
  },
  barraFondo: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORES.salviaClaro,
    marginBottom: 24,
  },
  barraRelleno: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORES.salvia,
  },
  encabezado: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORES.textoSuave,
    marginBottom: 12,
  },
  // El tamaño de letra de la pregunta y de las opciones, y el alto de las
  // opciones, se calculan en PantallaPregunta según la pantalla.
  pregunta: {
    fontWeight: 'bold',
    color: COLORES.texto,
    marginBottom: 16,
  },
  notaRecordada: {
    fontSize: 14,
    color: COLORES.salvia,
    marginBottom: 8,
  },
  // flexGrow: 1 hace que este View "vacío" crezca y ocupe el espacio que sobre.
  espacioFlexible: {
    flexGrow: 1,
    minHeight: 8,
  },
  opcion: {
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORES.bordeAzul,
    backgroundColor: COLORES.blanco,
  },
  opcionTexto: {
    color: COLORES.texto,
  },
  // Se suman a los de arriba cuando la persona toca esa opción.
  opcionElegida: {
    borderColor: COLORES.salvia,
    backgroundColor: COLORES.salviaClaro,
  },
  opcionTextoElegida: {
    fontWeight: 'bold',
    color: COLORES.salvia,
  },
  filaNavegacion: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },

  // --- Botones ---
  botonPrincipal: {
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: COLORES.salvia,
    marginTop: 16,
  },
  botonPrincipalTexto: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORES.blanco,
  },
  botonSecundario: {
    flex: 1,
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORES.borde,
  },
  botonSecundarioTexto: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORES.salvia,
  },
  botonLlamar: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: COLORES.salvia,
    marginTop: 12,
  },
  botonCrisis: {
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: COLORES.coral,
    marginTop: 12,
  },
  presionado: {
    opacity: 0.7,
  },
  desactivado: {
    opacity: 0.4,
  },

  // --- Tarjetas y secciones ---
  tarjeta: {
    padding: 16,
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: COLORES.azulClaro,
  },
  tarjetaTitulo: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORES.texto,
    marginBottom: 4,
  },
  seccion: {
    marginTop: 20,
  },
  vineta: {
    fontSize: 16,
    lineHeight: 24,
    color: COLORES.texto,
    marginBottom: 10,
  },
  etiquetaPrueba: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginBottom: 8,
    borderRadius: 8,
    overflow: 'hidden', // en iPhone, sin esto el fondo de un Text no respeta las esquinas redondas
    backgroundColor: COLORES.amarilloClaro,
    color: COLORES.amarilloTexto,
    fontSize: 13,
    fontWeight: 'bold',
  },

  // --- Pantalla de resultado ---
  tituloResultado: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORES.salvia,
    marginBottom: 12,
  },
  textoCrisis: {
    color: COLORES.coral,
  },
  tarjetaCrisis: {
    padding: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORES.coral,
    backgroundColor: COLORES.coralClaro,
  },
  telefonoCrisis: {
    fontSize: 26,
    fontWeight: 'bold',
    color: COLORES.coral,
    marginBottom: 4,
  },
  filaPuntaje: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORES.borde,
  },
  puntajeTema: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORES.texto,
    marginBottom: 2,
  },
  recordatorio: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORES.texto,
    marginTop: 24,
  },
  notaPequena: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORES.textoSuave,
    marginTop: 8,
  },
});
