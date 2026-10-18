DO $$
DECLARE
  pantry_department_id uuid;
BEGIN
  SELECT id
  INTO pantry_department_id
  FROM public.categorias
  WHERE nombre = 'Víveres y Alacena'
    AND departamento = 'Víveres y Alacena'
  ORDER BY id
  LIMIT 1;

  IF pantry_department_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró el departamento Víveres y Alacena.';
  END IF;

  UPDATE public.productos
  SET categoria_id = pantry_department_id,
      updated_at = now()
  WHERE (
    nombre ILIKE '%leche%polvo%'
    OR nombre ILIKE '%leche%condensada%'
  )
    AND categoria_id IS DISTINCT FROM pantry_department_id;
END
$$;

SELECT p.nombre, c.nombre AS categoria, c.departamento
FROM public.productos AS p
JOIN public.categorias AS c ON c.id = p.categoria_id
WHERE p.nombre ILIKE '%leche%polvo%'
   OR p.nombre ILIKE '%leche%condensada%'
ORDER BY p.nombre;
