# Módulo 3: Condicionales

Hasta ahora tus programas hacían siempre lo mismo, de arriba abajo. En este módulo aprenderás a que tu código **tome decisiones**: hacer una cosa si pasa algo y otra cosa si no pasa.

Piensa en un semáforo. Si está en verde, cruzas. Si no, esperas. Un condicional es exactamente eso: una pregunta con respuesta sí o no, y un camino para cada respuesta.

## 1. Booleanos: respuestas de sí o no

Python tiene un tipo de dato para las respuestas de sí o no. Se llama `bool` y solo tiene dos valores: `True` (verdadero) y `False` (falso).

```python
llueve = True
tengo_paraguas = False
```

Fíjate en las mayúsculas: `True` y `False` se escriben con la primera letra en mayúscula.

## 2. Operadores de comparación

Casi siempre obtienes un booleano al **comparar** dos valores:

| Operador | Significa | Ejemplo | Resultado |
|---|---|---|---|
| `==` | igual a | `5 == 5` | `True` |
| `!=` | distinto de | `5 != 3` | `True` |
| `<` | menor que | `2 < 1` | `False` |
| `>` | mayor que | `7 > 4` | `True` |
| `<=` | menor o igual que | `3 <= 3` | `True` |
| `>=` | mayor o igual que | `2 >= 5` | `False` |

Una trampa muy común: `=` **guarda** un valor y `==` **compara**. Piensa en `=` como "pon esto en la caja" y en `==` como "¿lo que hay en la caja es igual a esto?".

```python
temperatura = 30          # guardo el valor 30
print(temperatura == 30)  # pregunto si vale 30 -> True
```

## 3. `if`: haz algo solo si se cumple

La palabra `if` significa "si". Después va una condición, dos puntos `:` y, en las líneas siguientes, lo que se ejecuta cuando la condición es verdadera.

```python
temperatura = 32

if temperatura > 30:
    print("Hace calor, toma agua")

print("Fin del programa")
```

Dos detalles importantes:

- Los dos puntos `:` al final de la línea del `if` no se pueden olvidar.
- Las líneas que pertenecen al `if` van **indentadas** (con 4 espacios). La indentación le dice a Python qué líneas dependen de la condición. `print("Fin del programa")` no está indentada, así que se ejecuta siempre.

## 4. `else`: el plan B

`else` significa "si no". Es el camino que se toma cuando la condición del `if` es falsa.

```python
temperatura = 18

if temperatura > 30:
    print("Hace calor")
else:
    print("No hace tanto calor")
```

Solo se ejecuta **uno** de los dos caminos, nunca los dos. Como una bifurcación: o vas por la izquierda o por la derecha.

## 5. `elif`: más de dos caminos

¿Y si hay más de dos opciones? Para eso existe `elif`, que es la unión de "else" e "if": "si no, pero si...".

Imagina una fila de puertas numeradas. Python prueba la primera; si no se abre, prueba la segunda; y así hasta encontrar una que se abra. Entra por la primera que funcione y se olvida de las demás.

```python
temperatura = 22

if temperatura >= 30:
    print("Calor")
elif temperatura >= 15:
    print("Templado")
else:
    print("Frío")
```

Con `temperatura = 22`, la primera condición es falsa y la segunda es verdadera, así que imprime `Templado`. El `else` final atrapa todo lo que no cumplió ninguna condición anterior.

Puedes usar tantos `elif` como necesites, pero siempre va un solo `if` al inicio y, como máximo, un solo `else` al final.

### El orden importa

Como Python se detiene en la primera condición verdadera, el orden de tus condiciones cambia el resultado. Mira esto:

```python
temperatura = 35

if temperatura >= 15:
    print("Templado")
elif temperatura >= 30:
    print("Calor")
```

Con 35 grados imprime `Templado`, porque la primera puerta ya se abrió y la segunda nunca se revisa. Cuando uses rangos, pregúntate: ¿qué condición debería revisarse primero?

## 6. Casos límite: cuidado con los bordes

Los errores más frecuentes aparecen justo en el borde de un rango. La diferencia entre `>` y `>=` es la diferencia entre incluir o no incluir el valor del borde.

```python
compra = 100

if compra > 100:
    print("Tienes descuento")
else:
    print("Sin descuento")
```

Con una compra de exactamente 100, esto imprime `Sin descuento`. Si la regla dijera "100 o más tiene descuento", necesitarías `>=`.

Un buen hábito: cuando escribas una condición, prueba siempre el valor del borde y los valores justo a cada lado. Si el límite es 100, prueba con 99, 100 y 101.

## 7. Combinar condiciones: `and`, `or` y `not`

A veces una sola pregunta no alcanza. Puedes combinar booleanos:

- `and`: se cumplen **las dos** condiciones.
- `or`: se cumple **al menos una**.
- `not`: invierte el resultado.

```python
llueve = True
tengo_paraguas = False

if llueve and not tengo_paraguas:
    print("Mejor me quedo en casa")
```

## 8. Qué sigue: los ejercicios

Ahora te toca practicar con tres ejercicios, de menos a más difícil:

1. **Clasifica edades**: decidir en qué grupo cae una persona según su edad. Practica `if` y `else`.
2. **Signo de un número**: decidir si un número es positivo, negativo o cero. Practica `if`, `elif` y `else`.
3. **Nota con letra**: convertir un puntaje en una calificación con letra. Practica condiciones encadenadas y casos límite.

No hay prisa. Si te atascas, pide una pista o conversa con el tutor: te hará preguntas para que descubras el camino por ti mismo. Equivocarse es parte de aprender.
