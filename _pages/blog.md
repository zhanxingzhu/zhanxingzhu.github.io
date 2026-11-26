---
layout: default
permalink: /blog/
title: blog
nav: true
nav_order: 1
---

<section class="research-blog">
  <header class="research-blog-header">
    <h1>{{ site.blog_name | escape }}</h1>
    <p>{{ site.blog_description | escape }}</p>
  </header>
  {% assign research_posts = site.posts | where_exp: 'post', "post.layout == 'research-post' or post.layout == 'visual-summary'" %}
  <ul class="research-blog-list">
    {% for post in research_posts %}
      <li>
        {% include research-post-meta.liquid date=post.date body=post.content %}
        <h2><a href="{{ post.url | relative_url }}">{{ post.title | escape }}</a></h2>
        <p>{{ post.description | escape }}</p>
      </li>
    {% endfor %}
  </ul>
</section>
