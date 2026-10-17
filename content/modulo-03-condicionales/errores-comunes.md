# Errores comunes: Condicionales

Guía para el tutor. Reúne los errores más frecuentes del módulo 3 y cómo acompañar a la persona que los comete.

## Cómo usar esta guía

- Un error es una pista, no un fallo. Dilo con calma: "Python te está dejando una nota, vamos a leerla juntos".
- Primero pregunta, después explica. Empieza con la pregunta guía y solo da más ayuda si la persona sigue atascada.
- No escribas el código corregido completo. Señala la zona del problema y deja que la persona lo arregle.
- Respuestas cortas: una analogía, un ejemplo pequeño y una pregunta.
- Si la persona falla el mismo concepto 3 veces, cambia de analogía o baja la dificultad (por ejemplo, prueba con una condición más simple, sin `elif`).
- Los ejemplos de esta guía usan situaciones distintas a las de los ejercicios a propósito. No los mezcles con la solución de ningún ejercicio.

Cada error tiene cuatro partes: cómo se ve, qué dice Python (o qué síntoma aparece), cómo explicarlo con palabras simples y una pregunta guía.

---

## 1. Usar `=` en lugar de `==`

### Cómo se ve

```python
temperatura = 30

if temperatura = 30:
    print("Justo 30 grados")
```

### Qué dice Python

```
SyntaxError: invalid syntax. Maybe you meant '==' or ':=' instead of '='?
```

El mensaje apunta a la línea del `if`. Python incluso sugiere `==`, pero conviene que la persona entienda por qué.

### Cómo explicarlo en palabras simples

`=` y `==` se parecen, pero hacen cosas muy distintas.

- `=` es **guardar**: "pon este valor en la caja".
- `==` es **preguntar**: "¿lo que hay en la caja es igual a esto?".

Un `if` necesita una pregunta con respuesta de sí o no. Guardar algo en una caja no es una pregunta, por eso Python se confunde. Es como decirle al portero "¡soy mayor de edad!" en vez de preguntarle "¿soy mayor de edad?".

Un truco: lee `==` en voz alta como "es igual a" y `=` como "se guarda en".

### Pregunta guía para el tutor

- "En esa línea del `if`, ¿quieres guardar un valor o quieres preguntar si algo es igual a otra cosa?"
- "¿Qué diferencia había entre guardar en la caja y preguntar por lo que hay en la caja?"

### Variante silenciosa

Cuando la comparación falla sin error, por ejemplo porque se compara un número con un texto (`"30" == 30` da `False`), no hay mensaje. Pide a la persona que imprima ambos valores con `print()` y que mire si realmente se parecen.

---

## 2. Indentación incorrecta o ausente

### Cómo se ve

Falta indentar el bloque del `if`:

```python
llueve = True

if llueve:
print("Lleva paraguas")
```

Indentación que no coincide:

```python
llueve = True

if llueve:
    print("Lleva paraguas")
      print("Y un impermeable")
```

También hay una versión sin error, pero con resultado inesperado:

```python
llueve = False

if llueve:
    print("Lleva paraguas")
print("Y un impermeable")
```

Aquí el segundo `print` no está indentado, así que no depende del `if` y se muestra siempre.

### Qué dice Python

Para el primer caso:

```
IndentationError: expected an indented block after 'if' statement on line 3
```

Para el segundo caso:

```
IndentationError: unexpected indent
```

Si se mezclan niveles de sangría distintos, también puede aparecer:

```
IndentationError: unindent does not match any outer indentation level
```

En la versión sin error no hay mensaje. El síntoma es que algo se ejecuta cuando no debería.

### Cómo explicarlo en palabras simples

La indentación es como las **sangrías de un índice**: lo que está más adentro pertenece a lo que está justo arriba. Python no usa llaves ni palabras especiales para saber qué líneas son parte del `if`; usa los espacios al inicio de la línea.

Imagina una carpeta con archivos dentro. Si el archivo no está "dentro" de la carpeta (no tiene la sangría), Python piensa que está suelto afuera.

Regla simple: después de los dos puntos, las líneas que dependen del `if` llevan **4 espacios** y todas llevan los mismos.

### Pregunta guía para el tutor

- "¿Qué líneas quieres que se ejecuten solo cuando llueve? ¿Cómo se ve su inicio comparado con la línea del `if`?"
- "Si miras el inicio de cada línea, ¿están todas alineadas como esperas?"
- "Esta línea imprime siempre. ¿Pertenece al `if` o está afuera?"

---

## 3. Olvidar los dos puntos `:`

### Cómo se ve

```python
nivel_bateria = 10

if nivel_bateria < 20
    print("Conecta el cargador")
```

Lo mismo puede pasar con `elif` y `else`:

```python
if nivel_bateria < 20:
    print("Conecta el cargador")
else
    print("Todo bien")
```

### Qué dice Python

```
SyntaxError: expected ':'
```

El mensaje señala la línea donde falta (a veces con una flecha `^` al final de la línea).

### Cómo explicarlo en palabras simples

Los dos puntos son como el **"a continuación:"** al final de una frase antes de una lista. Le dicen a Python: "ya terminé de preguntar, lo que sigue es lo que debes hacer si la respuesta es sí".

Sin los dos puntos, Python se queda esperando el final de la pregunta. Es como decir "si tienes hambre" y quedarte callado: la persona espera a que sigas.

Un buen hábito: cada vez que escribas `if`, `elif` o `else`, cierra la línea con `:` antes de pasar a la siguiente.

### Pregunta guía para el tutor

- "Mira el final de la línea que señala Python. ¿Qué crees que falta para decirle 'aquí empieza lo que hay que hacer'?"
- "¿Cómo terminan tus líneas `if`, `elif` y `else`? ¿Terminan todas igual?"

---

## 4. `elif` que nunca se ejecuta (orden de condiciones)

### Cómo se ve

```python
cantidad = 25

if cantidad >= 10:
    print("Descuento básico")
elif cantidad >= 20:
    print("Descuento grande")
```

Con `cantidad = 25` se imprime `Descuento básico`. El descuento grande nunca llega, sin importar la cantidad.

### Qué dice Python

Nada. Este error **no genera mensaje**, el programa corre sin problemas. El síntoma es que el resultado es incorrecto o que una rama nunca se ejecuta, por ejemplo cuando una prueba falla solo con ciertos valores.

Por eso es el error más difícil de ver: Python no se queja, solo hace lo que le pediste.

### Cómo explicarlo en palabras simples

Python recorre las condiciones **de arriba abajo** y se queda con la **primera** que sea verdadera. Es como una fila de puertas: entras por la primera que se abre y te olvidas de las demás.

Si la primera puerta es muy ancha (`>= 10` deja pasar a todos los que tienen 10 o más), nadie llega a la segunda. La condición más específica quedó escondida detrás de la más general.

Regla práctica: pon primero la condición **más específica** (la que deja pasar a menos casos) y al final las más generales.

### Pregunta guía para el tutor

- "Si `cantidad` vale 25, ¿qué condición revisa Python primero? ¿Es verdadera?"
- "Cuando esa primera condición es verdadera, ¿Python revisa las que vienen después?"
- "¿Qué valores dejan pasar la primera condición? ¿Queda algún valor que pueda llegar a la segunda?"
- "Prueba con un valor concreto y sigue el camino con el dedo, puerta por puerta. ¿Dónde te quedas?"

### Consejo de práctica

Pide a la persona que pruebe un valor en cada rango y justo en cada borde. Si esperaba una respuesta distinta, que escriba qué `if` o `elif` cree que se ejecutó y lo compare con lo que realmente imprimió.

---

## Pistas rápidas para el tutor

| Síntoma | Probable causa | Primera pregunta |
|---|---|---|
| `SyntaxError: invalid syntax. Maybe you meant '==' ...` | `=` en vez de `==` | ¿Guardas o preguntas? |
| `IndentationError: expected an indented block` | Falta indentar tras `:` | ¿Qué líneas dependen del `if`? |
| `IndentationError: unexpected indent` | Sangría de más | ¿Esta línea debe estar tan adentro? |
| `SyntaxError: expected ':'` | Faltan los dos puntos | ¿Cómo termina esa línea? |
| Sin error, pero el resultado no es el esperado | Orden de condiciones o borde (`>` vs `>=`) | ¿Qué condición revisa Python primero con este valor? |
