#!/usr/bin/env python3
"""Генерирует собственные SVG-афиши, обложки и картинки новостей (без сторонних материалов)."""
import os, textwrap
from xml.sax.saxutils import escape

OUT = os.path.join(os.path.dirname(__file__), '..', 'apps', 'web', 'public', 'img')
PAL = {
    'navy': ('#0e2a52', '#1d4f8f'), 'teal': ('#0b4f55', '#1b8a8f'), 'green': ('#14502f', '#2f8a56'),
    'amber': ('#6b3a0a', '#b8741f'), 'graphite': ('#1f2430', '#4b5565'), 'blue': ('#0a4aa6', '#3b8ae6'),
    'wine': ('#5a1f2b', '#a14459'),
}

def motif(kind, w, h):
    s = 'fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="%d"' % max(8, w // 40)
    if kind == 0:
        return f'<path d="M{w*0.62} {h} V{h*0.45} a{w*0.2} {w*0.2} 0 0 1 {w*0.4} 0 V{h}" {s}/><circle cx="{w*0.2}" cy="{h*0.25}" r="{h*0.14}" {s}/>'
    if kind == 1:
        return f'<circle cx="{w*0.82}" cy="{h*0.3}" r="{h*0.34}" {s}/><circle cx="{w*0.82}" cy="{h*0.3}" r="{h*0.2}" {s}/>'
    if kind == 2:
        return ''.join(f'<path d="M{w*(0.45+i*0.12)} {h} L{w*(0.75+i*0.12)} 0" {s}/>' for i in range(4))
    return f'<rect x="{w*0.58}" y="{h*0.12}" width="{w*0.3}" height="{w*0.3}" rx="{w*0.05}" {s} transform="rotate(12 {w*0.7} {h*0.3})"/><path d="M0 {h*0.85} H{w*0.5}" {s}/>'

def svg(path, w, h, pal, kind, tag, title, sub=''):
    c1, c2 = PAL[pal]
    size = int(h * (0.105 if w > h else 0.075))
    lines = textwrap.wrap(title, 22 if w > h else 14)[:4]
    y0 = h * (0.5 if w > h else 0.42)
    tspans = ''.join(f'<tspan x="{w*0.07}" dy="{size*1.18 if i else 0}">{escape(l)}</tspan>' for i, l in enumerate(lines))
    body = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="{escape(title)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient></defs>
<rect width="{w}" height="{h}" fill="url(#g)"/>{motif(kind, w, h)}
<text x="{w*0.07}" y="{h*0.14}" font-family="Helvetica, Arial, sans-serif" font-size="{int(size*0.5)}" font-weight="700" fill="#ffffff" fill-opacity="0.85">{escape(tag)}</text>
<text x="{w*0.07}" y="{y0}" font-family="Helvetica, Arial, sans-serif" font-size="{size}" font-weight="700" fill="#ffffff">{tspans}</text>
<text x="{w*0.07}" y="{h*0.93}" font-family="Helvetica, Arial, sans-serif" font-size="{int(size*0.45)}" fill="#ffffff" fill-opacity="0.8">{escape(sub)}</text>
</svg>'''
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, 'w', encoding='utf-8').write(body)

EVENTS = [
    ('e0', 'navy', 0, 'Наука', 'Лаборатория ИИ-агентов: открытая встреча', 'Ауд. 530'),
    ('e1', 'teal', 1, 'Наука', 'Воркшоп по цифровому моделированию', 'Ауд. 530'),
    ('e2', 'green', 2, 'Карьера', 'Ярмарка стажировок', 'Главный холл'),
    ('e3', 'wine', 3, 'Клубы', 'Дебаты: цифровые валюты центробанков', 'Ауд. 214'),
    ('e4', 'blue', 0, 'Карьера', 'Кейс-чемпионат по студенческим сервисам', 'Онлайн и ауд. 101'),
    ('e5', 'amber', 1, 'Спорт', 'Турнир по мини-футболу', 'Спортзал'),
    ('p0', 'blue', 2, 'Хакатон', 'Хакатон «Цифровой деканат»', 'Прошло'),
    ('p1', 'graphite', 3, 'Лидерство', 'Школа студенческих лидеров', 'Прошло'),
    ('p2', 'navy', 1, 'Лекция', 'Открытая лекция о цифровой экономике', 'Прошло'),
    ('p3', 'amber', 0, 'Спорт', 'Турнир по настольному теннису', 'Прошло'),
    ('p4', 'wine', 2, 'Клубы', 'Дебаты первокурсников', 'Прошло'),
]
for slug, pal, kind, tag, title, sub in EVENTS:
    svg(f'events/{slug}.svg', 800, 450, pal, kind, tag, title, sub)

NEWS = [
    ('n0', 'navy', 0, 'Новости', 'Новый личный кабинет', 'Установите на телефон'),
    ('n1', 'teal', 3, 'Сессия', 'Консультации перед сессией', 'С 15 декабря'),
    ('n2', 'graphite', 1, 'Общежитие', 'Приём заявлений продлён', 'До 5 декабря'),
    ('n3', 'blue', 2, 'Итоги', 'Итоги хакатона «Цифровой деканат»', 'Поздравляем победителей'),
    ('n4', 'green', 0, 'Библиотека', 'В библиотеке новые учебники', 'Сорок новых изданий'),
]
for slug, pal, kind, tag, title, sub in NEWS:
    svg(f'news/{slug}.svg', 800, 450, pal, kind, tag, title, sub)

BOOKS = [
    ('b0', 'navy', 'Микроэкономика: базовый курс'), ('b1', 'teal', 'Макроэкономика для бакалавров'),
    ('b2', 'green', 'Менеджмент гостеприимства'), ('b3', 'amber', 'Туристские ресурсы мира'),
    ('b4', 'graphite', 'Основы международного права'), ('b5', 'blue', 'Деловой английский: практикум'),
    ('b6', 'wine', 'Французский для международных отношений'), ('b7', 'navy', 'Python для анализа данных'),
    ('b8', 'teal', 'Статистика и эконометрика'), ('b9', 'green', 'Финансы и кредит'),
]
for i, (slug, pal, title) in enumerate(BOOKS):
    svg(f'books/{slug}.svg', 300, 420, pal, i % 4, 'Учебник', title, 'Цифровой деканат')
print('ok')
