# Datos de validación

`tests/fixtures/canonical-face.json` deriva de
[canonical_face_model.obj de MediaPipe](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj).
Copyright The MediaPipe Authors. Licencia Apache 2.0, conservada íntegramente en
`licenses/mediapipe-apache-2.0.txt`. Se convirtió OBJ a posiciones e índices JSON;
el replay recentra en landmark 6 y normaliza el ancho a 135 mm. Es un fixture
de prueba, no una calibración biométrica de una persona.

Los tres repositorios de referencia se consultaron para arquitectura y conceptos;
no se incorporaron sus implementaciones al código de Stylo.
